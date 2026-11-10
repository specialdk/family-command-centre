/* Listening and speaking, in the browser.

   Claude has no speech-to-speech API, so this is speech → text → Claude →
   speech. The pause in the middle is real and cannot be engineered away
   here; what can be done is to make the waiting visible, which is what the
   orb's listening state and the thinking line are for.

   Both halves are the browser's own: SpeechRecognition for listening and
   speechSynthesis for speaking. No vendor, no key, no per-minute cost. The
   price is uneven support, so `supported` is checked rather than assumed and
   the orb simply does not offer itself where it would not work. */

const Recognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;

export const canListen = !!Recognition;
export const canSpeak =
  typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

/* Safari will not speak unless the first utterance happens inside a real
   user gesture. A reply arrives long after the tap that asked for it, so the
   tap primes the engine with silence and everything after it is allowed. */
let primed = false;
export function primeSpeech() {
  if (!canSpeak || primed) return;
  try {
    const silence = new SpeechSynthesisUtterance("");
    silence.volume = 0;
    window.speechSynthesis.speak(silence);
    primed = true;
  } catch { /* not fatal: it just means the first reply may stay silent */ }
}

/* An English speech engine reads the letters: Rhian comes out "Ree-ann" and
   Danielle "Dan-ee-ell". Neither is anyone's name. Each family member can
   record how theirs is said and it is swapped in here, in the spoken text
   only - the screen always shows the real spelling.

   Longest first, so "Anne-Marie" is not half-replaced by a rule for "Anne",
   and word-bounded, so a name inside another word is left alone. The
   boundary sits before an apostrophe, which keeps "Rhian's" working. */
export function sayAs(text, pronunciations) {
  let out = String(text || "");
  if (!pronunciations) return out;
  const pairs = Object.entries(pronunciations)
    .filter(([name, say]) => name && say && name.toLowerCase() !== String(say).toLowerCase())
    .sort((a, b) => b[0].length - a[0].length);
  for (const [name, say] of pairs) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /* Not \b: that only knows ASCII letters, so a name beginning with ŋ -
       Yolŋu names, among others - would never match, and a name ending in a
       full stop would never match either. A letter-or-number test on each
       side, with the preceding character captured rather than looked behind,
       because lookbehind is still missing on older iOS. */
    const edge = "[\\p{L}\\p{N}]";
    out = out.replace(
      new RegExp(`(^|(?!${edge}).)(${safe})(?!${edge})`, "giu"),
      (_m, before) => before + say
    );
  }
  return out;
}

export function speak(text, { onDone, pronunciations } = {}) {
  if (!canSpeak || !text) return onDone?.();
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(sayAs(text, pronunciations));
    u.lang = "en-AU";
    u.rate = 1.02;
    u.onend = () => onDone?.();
    u.onerror = () => onDone?.();
    window.speechSynthesis.speak(u);
  } catch { onDone?.(); }
}

export function stopSpeaking() {
  if (!canSpeak) return;
  try { window.speechSynthesis.cancel(); } catch { /* nothing to stop */ }
}

/* One utterance at a time, not a running transcript: a family asks a
   question and waits for an answer. Interim results are passed up only so
   the screen can show the words arriving - the final one is what is sent. */
export function listen({ onInterim, onResult, onEnd, onError }) {
  if (!Recognition) return () => {};

  const rec = new Recognition();
  rec.lang = "en-AU";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    if (interim) onInterim?.(interim.trim());
    if (finalText) onInterim?.(finalText.trim());
  };

  rec.onerror = (e) => {
    /* "no-speech" and "aborted" are ordinary - someone pressed the orb and
       changed their mind. Only the rest are worth telling anyone about. */
    const quiet = e.error === "no-speech" || e.error === "aborted";
    onError?.(
      quiet ? null
      : e.error === "not-allowed" ? "The microphone is blocked for this site."
      : e.error === "network" ? "Listening needs a connection."
      : "That didn't come through."
    );
  };

  rec.onend = () => {
    const said = finalText.trim();
    if (said) onResult?.(said);
    onEnd?.();
  };

  try { rec.start(); } catch { onEnd?.(); }
  return () => { try { rec.abort(); } catch { /* already stopped */ } };
}

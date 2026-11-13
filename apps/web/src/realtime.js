/* Talking to Jade: a live WebRTC session with OpenAI's Realtime API.

   Audio goes from the browser straight to OpenAI and back. It does not pass
   through Railway, because putting a server hop in the middle of every
   syllable is the difference between a conversation and a walkie-talkie.

   What does pass through our server: the session's instructions and tools,
   baked into a short-lived token before the browser ever sees it, and every
   tool the model calls. So the model can read the family's week and draft a
   change, and still cannot write anything - the same rule the typed path
   has, enforced in the same place.

   The one thing the documentation would not tell me is which event carries
   an incoming function call. The reference describes the item shape
   verbatim - type "function_call", with name, arguments and call_id - but
   not reliably which event wraps it. So this listens for the item in every
   shape it could arrive in and de-duplicates by call_id, which is the
   honest way to write against a detail you cannot confirm. */

export const canTalk = typeof window !== "undefined"
  && typeof window.RTCPeerConnection !== "undefined"
  && !!navigator?.mediaDevices?.getUserMedia;

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/* Function calls that are FINISHED. A call is announced first with empty
   arguments ("output_item.added") and filled in afterwards. Acting on the
   announcement sent the server a move with no title, and the real one was
   then skipped as a duplicate. So: remember names from announcements, act
   only on events that carry the complete arguments. */
function functionCallsIn(msg, names) {
  const out = [];
  const remember = (item) => {
    if (item?.type === "function_call" && item.call_id && item.name) names.set(item.call_id, item.name);
  };
  remember(msg?.item);
  for (const o of msg?.response?.output || []) remember(o);
  const finished = (item) => item?.type === "function_call" && item.name && item.status !== "in_progress";
  if (msg?.type === "response.function_call_arguments.done" && msg.call_id) {
    out.push({ call_id: msg.call_id, name: msg.name || names.get(msg.call_id), arguments: msg.arguments });
  }
  if (msg?.type === "response.output_item.done" && finished(msg.item)) out.push(msg.item);
  if (msg?.type === "response.done") for (const o of msg.response?.output || []) if (finished(o)) out.push(o);
  return out.filter((c) => c.name);
}

/**
 * Opens a conversation. Returns a handle with stop(), or throws with a
 * message worth showing someone.
 *
 * onEvent gets {kind, ...} for the UI: "listening", "thinking", "speaking",
 * "said" (what the person said), "reply" (what Jade said), "proposal".
 */
export async function startConversation({ onEvent, onError, speaker = null, aboutTaskId = null, idea = null }) {
  if (!canTalk) throw new Error("This browser cannot hold a conversation.");

  /* The microphone first: if it is refused, nothing else is worth doing, and
     the person should hear about that rather than a connection error. */
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Jade needs the microphone. Allow it for this site and try again.");
  }

  const token = await fetch("/api/jade/realtime/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ speaker, aboutTaskId, idea })
  }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || d.error || "Could not start a conversation.");
    return d;
  }).catch((e) => { mic.getTracks().forEach((t) => t.stop()); throw e; });

  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };
  pc.addTrack(mic.getTracks()[0]);

  /* Created before the offer, because the channel has to be in the SDP. */
  const channel = pc.createDataChannel("oai-events");
  /* Opened from a reminder: Jade speaks first ("Bins - done, or later?"),
     so the person only has to answer. */
  if (aboutTaskId || idea) channel.addEventListener("open", () => send({ type: "response.create" }));
  /* What was said, both ways, so a saved idea keeps the actual conversation. */
  const lines = [];
  const handled = new Set();
  const callNames = new Map();   // call_id -> tool name, from the announcement
  let stopped = false;

  const send = (obj) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(obj));
  };

  channel.addEventListener("message", async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    /* Narration for the orb. These are the states a person can see the
       difference between; everything else is noise. */
    if (msg.type === "input_audio_buffer.speech_started") onEvent?.({ kind: "listening" });
    if (msg.type === "input_audio_buffer.speech_stopped") onEvent?.({ kind: "thinking" });
    if (msg.type === "response.created") onEvent?.({ kind: "thinking" });
    if (msg.type === "output_audio_buffer.started") onEvent?.({ kind: "speaking" });

    /* Transcripts, so there is something on screen as well as in the air -
       useful in a noisy kitchen, and the only record of what was asked. */
    const saidText = msg?.transcript;
    if (typeof saidText === "string" && saidText.trim()) {
      if (/input_audio_transcription/.test(msg.type || "")) {
        onEvent?.({ kind: "said", text: saidText.trim() });
        lines.push(`${speaker || "Them"}: ${saidText.trim()}`);
      } else if (/output_audio_transcript\.done/.test(msg.type || "")) {
        onEvent?.({ kind: "reply", text: saidText.trim() });
        lines.push(`Jade: ${saidText.trim()}`);
      }
    }

    for (const call of functionCallsIn(msg, callNames)) {
      const id = call.call_id || call.id;
      if (!id || handled.has(id)) continue;      // the same call can arrive twice
      handled.add(id);

      let result = { output: "That could not be looked up just now." };
      try {
        result = await fetch("/api/jade/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: call.name, arguments: call.arguments, speaker,
            transcript: lines.join("\n"), ideaId: idea?.id ?? null
          })
        }).then((r) => r.json());
      } catch { /* keep the fallback text */ }

      if (result.proposal) onEvent?.({ kind: "proposal", proposal: result.proposal });
      if (result.applied)  onEvent?.({ kind: "applied", applied: result.applied });

      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: id, output: String(result.output ?? "") }
      });
      /* The API does not produce the follow-up itself, so ask for it. */
      send({ type: "response.create" });
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const answer = await fetch(CALLS_URL, {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" }
  });
  if (!answer.ok) {
    mic.getTracks().forEach((t) => t.stop());
    pc.close();
    throw new Error("Jade could not connect. Try again in a moment.");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });

  pc.addEventListener("connectionstatechange", () => {
    if (stopped) return;
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      onError?.("The conversation dropped.");
      stop();
    }
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    try { mic.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
    try { channel.close(); } catch { /* already closed */ }
    try { pc.close(); } catch { /* already closed */ }
    try { audio.pause(); audio.srcObject = null; } catch { /* nothing playing */ }
    onEvent?.({ kind: "ended" });
  }

  onEvent?.({ kind: "listening" });
  return { stop, say: (text) => {
    /* Used after a proposal is approved, so Jade knows what happened rather
       than being left mid-sentence waiting on a tap it cannot see. */
    send({ type: "conversation.item.create",
           item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    send({ type: "response.create" });
  } };
}
import React, { useEffect, useRef, useState } from "react";
import { canListen, canSpeak, listen, primeSpeech, speak, stopSpeaking } from "./voice.js";
import { canTalk, startConversation } from "./realtime.js";

/* Jade's sheet, built to the design already in Rhian's stylesheet rather than
   invented: .assistant-sheet, the 76px .listen-orb with its listening pulse,
   .assistant-reply for the answer and .proposal-card for anything that would
   change data.

   The proposal card is the whole point. Jade never writes - it drafts, and a
   person presses Add, Schedule or Send. That is his design, and it is also
   the only honest way to let a model near a shared family calendar. */

const api = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Jade could not answer just now.");
  return data;
};

const APPLY_LABEL = {
  add_task: "Add the task",
  schedule_event: "Put it on the calendar",
  move_item: "Move it",
  complete_task: "Mark it done",
  notify_family: "Send it to everyone"
};

const DONE_LABEL = {
  notify_family: "Sent to the family.",
  schedule_event: "It's on the calendar.",
  move_item: "Moved.",
  complete_task: "Ticked off.",
  add_task: "Added to the list."
};

export default function Jade({ viewer, members = [], about = null, onClose, onChanged }) {
  /* name -> how it is said, for the speech engine only. */
  const pronunciations = React.useMemo(
    () => Object.fromEntries(
      members.filter((m) => m.pronunciation).map((m) => [m.name, m.pronunciation])
    ),
    [members]
  );

  const [asked, setAsked]       = useState("");
  const [reply, setReply]       = useState("");
  const [proposal, setProposal] = useState(null);
  const [history, setHistory]   = useState([]);
  const [busy, setBusy]         = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone]         = useState("");
  const [error, setError]       = useState("");
  const [hearing, setHearing]   = useState(false);
  const [heard, setHeard]       = useState("");
  const [mute, setMute]         = useState(false);
  /* A change Jade made straight away (the speaker's own task), kept so it
     can be undone if she misheard. */
  const [undo, setUndo]         = useState(null);
  /* The live conversation, when there is one: a WebRTC session where Jade
     hears and speaks for itself. `phase` is what the orb is showing -
     listening, thinking or speaking - which is the only honest way to tell
     someone whether it is their turn. */
  const [phase, setPhase]       = useState("");
  const liveRef = useRef(null);
  /* Why the conversation could not start. Its own state, not `error`: the
     fallback clears error on its way past, and so does the next question,
     which between them made a failure invisible twice over. This line stays
     under the orb until a conversation actually starts. */
  const [liveNote, setLiveNote] = useState("");
  /* Rendering has to know a conversation exists, and a ref does not trigger
     a re-render, so the phase doubles as the flag. */
  const live = phase !== "";
  const inputRef = useRef(null);
  const stopRef  = useRef(null);
  /* Whether the question came by voice. A spoken question gets a spoken
     answer; a typed one does not, because nobody wants a phone talking at
     them because they typed in a quiet room. */
  const spokenRef = useRef(false);

  /* Typing is the fallback, so the keyboard should not leap up on a phone
     where the orb is the point. */
  useEffect(() => { if (!canListen) inputRef.current?.focus(); }, []);

  /* Opening this sheet is already the "I want to talk" gesture, so asking
     for a second tap on the orb earned nothing. It starts listening by
     itself; the orb becomes the way to stop, and typing stops it too, so the
     microphone is never live while someone is at the keyboard. The short
     delay lets the sheet paint first - the pulse starting on a half-drawn
     orb reads as a glitch. */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (!canTalk && !canListen) return;
    started.current = true;
    const t = setTimeout(() => begin(), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Leaving mid-sentence stops the voice with you. */
  useEffect(() => () => {
    liveRef.current?.stop(); stopRef.current?.(); stopSpeaking();
  }, []);

  /* A conversation, if this browser and this server can hold one. It falls
     back to the one-question-at-a-time path rather than failing: a family
     standing in a kitchen should get an answer, not an explanation of why
     WebRTC did not connect. */
  const beginTalking = async () => {
    setError(""); setHeard(""); setDone(""); setPhase("connecting");
    try {
      liveRef.current = await startConversation({
        speaker: viewer?.name || null,
        aboutTaskId: about?.id ?? null,
        onEvent: (e) => {
          if (e.kind === "said")      { setHeard(e.text); setAsked(e.text); }
          if (e.kind === "reply")     { setReply(e.text); setHeard(""); }
          if (e.kind === "proposal")  setProposal(e.proposal);
          if (e.kind === "applied") {
            setUndo(e.applied);
            setDone(`${e.applied.kind === "complete" ? "Ticked off" : "Moved"}: ${e.applied.title}`);
            onChanged?.();
          }
          if (e.kind === "ended")     { setPhase(""); liveRef.current = null; }
          if (["listening", "thinking", "speaking"].includes(e.kind)) setPhase(e.kind);
        },
        onError: (msg) => setError(msg)
      });
      return true;
    } catch (e) {
      liveRef.current = null;
      setPhase("");
      console.warn("Jade: conversation did not start —", e.message);
      setLiveNote(e.message);
      return false;
    }
  };

  const begin = async () => {
    if (canTalk) {
      if (await beginTalking()) { setLiveNote(""); return; }
    } else {
      /* Not even attempted. Worth saying so plainly - a browser that cannot
         open a conversation looks identical to one where it failed. */
      setLiveNote("This browser can't open a conversation (no WebRTC or no microphone access).");
    }
    if (canListen) toggleListening();        // the older, turn-based path
  };

  const endTalking = () => { liveRef.current?.stop(); liveRef.current = null; setPhase(""); };

  const ask = async (text, { spoken = false } = {}) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    stopSpeaking();
    spokenRef.current = spoken;
    setBusy(true); setError(""); setDone(""); setProposal(null); setAsked(message); setHeard("");
    try {
      const data = await api("/api/jade", {
        message, history, speaker: viewer?.name || null, aboutTaskId: about?.id ?? null
      });
      setReply(data.reply || "");
      setProposal(data.proposal || null);
      setHistory(data.history || []);
      if (data.applied) { setUndo(data.applied); onChanged?.(); }
      /* A proposal is not read out. It is a thing to look at and approve,
         and hearing "shall I send this to everyone" is not consent. */
      if (spoken && !mute && !data.proposal) speak(data.reply, { pronunciations });
    } catch (e) {
      setError(e.message);
      setReply("");
    } finally {
      setBusy(false);
    }
  };

  const toggleListening = () => {
    if (liveRef.current) { endTalking(); return; }
    if (hearing) { stopRef.current?.(); return; }
    if (busy) return;
    if (canTalk && !started.current) { begin(); return; }
    primeSpeech();            // must happen inside the tap, for Safari
    stopSpeaking();
    setError(""); setHeard(""); setHearing(true);
    stopRef.current = listen({
      onInterim: setHeard,
      onResult: (said) => { setAsked(said); ask(said, { spoken: true }); },
      onEnd: () => { setHearing(false); stopRef.current = null; },
      onError: (msg) => { if (msg) setError(msg); }
    });
  };

  const apply = async () => {
    if (!proposal || applying) return;
    setApplying(true); setError("");
    try {
      await api("/api/jade/apply", { proposal, memberId: viewer?.id ?? null });
      /* Tell the conversation what happened. Otherwise Jade is left waiting
         on a tap it cannot see, and the next thing it says ignores it. */
      liveRef.current?.say(`I approved it. ${DONE_LABEL[proposal.tool] || "It is done."}`);
      setDone(DONE_LABEL[proposal.tool] || "Done.");
      setProposal(null);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  const undoIt = async () => {
    if (!undo) return;
    try {
      await api("/api/jade/undo", { taskId: undo.taskId, before: undo.before });
      liveRef.current?.say("I pressed Undo, so that change has been reversed. Just acknowledge it briefly.");
      setDone(`Put back: ${undo.title}`);
      setUndo(null);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="assistant-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {/* Rhian's orb, with his own listening pulse. It pulses while the
            conversation is live, whichever way round the talking is going,
            and the line underneath says which - because in a conversation
            the only thing a person needs to know is whose turn it is. */}
        <button
          className={`listen-orb ${(live || hearing) ? "listening" : ""}`}
          onClick={toggleListening}
          disabled={!canTalk && !canListen}
          title={!canTalk && !canListen ? "This browser can't listen — type instead"
                : live ? "End the conversation" : "Tap and ask"}
          aria-pressed={!!live || hearing}
        >
          <span className="voice-mark"><i /><i /><i /><i /></span>
        </button>

        {(canTalk || canListen) ? (
          <button type="button" className="listen-button" onClick={toggleListening}>
            {phase === "connecting" ? "Connecting…"
              : phase === "listening" ? "Listening — tap to end"
              : phase === "thinking" ? "Thinking…"
              : phase === "speaking" ? "Jade is talking — just interrupt"
              : hearing ? "Listening — tap to stop"
              : "Tap the circle and talk"}
          </button>
        ) : (
          <p className="listen-button" style={{ pointerEvents: "none" }}>
            This browser can't listen — type instead
          </p>
        )}

        {liveNote && (
          <p className="assistant-rule" style={{ margin: "6px auto 0", maxWidth: 420, color: "#9a713b" }}>
            One question at a time — {liveNote}
          </p>
        )}

        {canSpeak && canListen && !live && (
          <button
            type="button"
            className="listen-button"
            style={{ display: "block", margin: "2px auto 0", fontSize: 12, opacity: .75 }}
            onClick={() => { setMute((m) => !m); stopSpeaking(); }}
          >
            {mute ? "Answers are silent — tap to hear them" : "Answers are read aloud — tap to silence"}
          </button>
        )}

        <h2>Jade</h2>
        {about && (
          <p className="eyebrow" style={{ textAlign: "center", margin: "-4px 0 8px" }}>ABOUT · {about.title}</p>
        )}

        <div className="assistant-reply">
          {/* `done` outranks `reply`: once something has been applied, the
              confirmation is the news, not the draft that preceded it. Asking
              again clears it. */}
          {heard ? heard
            : live && !reply ? "Ask away."
            : hearing ? "Listening…"
            : busy ? "Thinking…"
            : error ? error
            : done ? done
            : reply ? reply
            : about ? `${about.title} — done, or later?`
            : `Ask me what's on, or what still needs doing${viewer?.name ? `, ${viewer.name}` : ""}.`}
        </div>

        {undo && (
          <div className="sheet-actions" style={{ justifyContent: "center", marginTop: 8 }}>
            <button type="button" className="chip-button" onClick={undoIt}>Undo</button>
          </div>
        )}

        {proposal && (
          <div className="proposal-card">
            <span>{proposal.kicker}</span>
            <strong>{proposal.title}</strong>
            {proposal.detail && <small>{proposal.detail}</small>}
            <div className="sheet-actions" style={{ marginTop: 12 }}>
              <button type="button" className="chip-button" onClick={() => setProposal(null)}>
                No thanks
              </button>
              <button type="button" onClick={apply} disabled={applying}>
                {applying ? "Just a sec…" : (APPLY_LABEL[proposal.tool] || "Do it")}
              </button>
            </div>
          </div>
        )}

        <form
          className="assistant-form"
          onSubmit={(e) => { e.preventDefault(); ask(asked); }}
        >
          <input
            ref={inputRef}
            value={asked}
            onChange={(e) => { if (hearing) stopRef.current?.(); setAsked(e.target.value); }}
            placeholder="What's on tomorrow?"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !asked.trim()}>Ask</button>
        </form>

        <p className="assistant-rule">
          Jade can look at the calendar and the task list. Your own tasks it ticks off
          or moves straight away; anything else it drafts for you to approve.
        </p>
      </div>
    </div>
  );
}
import React, { useEffect, useRef, useState } from "react";
import { canListen, canSpeak, listen, primeSpeech, speak, stopSpeaking } from "./voice.js";

/* Sol's sheet, built to the design already in Rhian's stylesheet rather than
   invented: .assistant-sheet, the 76px .listen-orb with its listening pulse,
   .assistant-reply for the answer and .proposal-card for anything that would
   change data.

   The proposal card is the whole point. Sol never writes - it drafts, and a
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
  if (!res.ok) throw new Error(data.error || "Sol could not answer just now.");
  return data;
};

const APPLY_LABEL = {
  add_task: "Add the task",
  schedule_event: "Put it on the calendar",
  notify_family: "Send it to everyone"
};

export default function Sol({ viewer, onClose, onChanged }) {
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
  const inputRef = useRef(null);
  const stopRef  = useRef(null);
  /* Whether the question came by voice. A spoken question gets a spoken
     answer; a typed one does not, because nobody wants a phone talking at
     them because they typed in a quiet room. */
  const spokenRef = useRef(false);

  /* Typing is the fallback, so the keyboard should not leap up on a phone
     where the orb is the point. */
  useEffect(() => { if (!canListen) inputRef.current?.focus(); }, []);

  /* Leaving mid-sentence stops the voice with you. */
  useEffect(() => () => { stopRef.current?.(); stopSpeaking(); }, []);

  const ask = async (text, { spoken = false } = {}) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    stopSpeaking();
    spokenRef.current = spoken;
    setBusy(true); setError(""); setDone(""); setProposal(null); setAsked(message); setHeard("");
    try {
      const data = await api("/api/sol", { message, history });
      setReply(data.reply || "");
      setProposal(data.proposal || null);
      setHistory(data.history || []);
      /* A proposal is not read out. It is a thing to look at and approve,
         and hearing "shall I send this to everyone" is not consent. */
      if (spoken && !mute && !data.proposal) speak(data.reply);
    } catch (e) {
      setError(e.message);
      setReply("");
    } finally {
      setBusy(false);
    }
  };

  const toggleListening = () => {
    if (hearing) { stopRef.current?.(); return; }
    if (busy) return;
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
      await api("/api/sol/apply", { proposal, memberId: viewer?.id ?? null });
      setDone(
        proposal.tool === "notify_family" ? "Sent to the family."
        : proposal.tool === "schedule_event" ? "It's on the calendar."
        : "Added to the list."
      );
      setProposal(null);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="assistant-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {/* Rhian's orb, with his own listening pulse. It only offers itself
            where the browser can actually hear - a button that does nothing
            is worse than no button. */}
        <button
          className={`listen-orb ${hearing ? "listening" : ""}`}
          onClick={toggleListening}
          disabled={!canListen || busy}
          title={!canListen ? "This browser can't listen — type instead"
                : hearing ? "Stop listening" : "Tap and ask"}
          aria-pressed={hearing}
        >
          <span className="voice-mark"><i /><i /><i /><i /></span>
        </button>

        {canListen ? (
          <button type="button" className="listen-button" onClick={toggleListening} disabled={busy}>
            {hearing ? "Listening — tap to stop" : "Tap the circle and ask"}
          </button>
        ) : (
          <p className="listen-button" style={{ pointerEvents: "none" }}>
            This browser can't listen — type instead
          </p>
        )}

        {canSpeak && canListen && (
          <button
            type="button"
            className="listen-button"
            style={{ display: "block", margin: "2px auto 0", fontSize: 12, opacity: .75 }}
            onClick={() => { setMute((m) => !m); stopSpeaking(); }}
          >
            {mute ? "Answers are silent — tap to hear them" : "Answers are read aloud — tap to silence"}
          </button>
        )}

        <h2>Sol</h2>

        <div className="assistant-reply">
          {/* `done` outranks `reply`: once something has been applied, the
              confirmation is the news, not the draft that preceded it. Asking
              again clears it. */}
          {hearing && heard ? heard
            : hearing ? "Listening…"
            : busy ? "Thinking…"
            : error ? error
            : done ? done
            : reply ? reply
            : `Ask me what's on, or what still needs doing${viewer?.name ? `, ${viewer.name}` : ""}.`}
        </div>

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
            onChange={(e) => setAsked(e.target.value)}
            placeholder="What's on tomorrow?"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !asked.trim()}>Ask</button>
        </form>

        <p className="assistant-rule">
          Sol can look at the calendar and the task list. Anything it would change,
          it drafts for you to approve first.
        </p>
      </div>
    </div>
  );
}

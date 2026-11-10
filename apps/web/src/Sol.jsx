import React, { useEffect, useRef, useState } from "react";

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
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const ask = async (text) => {
    const message = String(text || "").trim();
    if (!message || busy) return;
    setBusy(true); setError(""); setDone(""); setProposal(null); setAsked(message);
    try {
      const data = await api("/api/sol", { message, history });
      setReply(data.reply || "");
      setProposal(data.proposal || null);
      setHistory(data.history || []);
    } catch (e) {
      setError(e.message);
      setReply("");
    } finally {
      setBusy(false);
    }
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

        {/* The orb is Rhian's, and it is honest about not listening yet: voice
            is speech-to-text on top of this, not part of it. */}
        <button
          className="listen-orb"
          disabled
          title="Talking to Sol is coming — type for now"
        >
          <span className="voice-mark"><i /><i /><i /><i /></span>
        </button>
        <p className="listen-button" style={{ pointerEvents: "none" }}>
          Type for now — talking comes next
        </p>

        <h2>Sol</h2>

        <div className="assistant-reply">
          {busy ? "Thinking…"
            : error ? error
            : reply ? reply
            : done ? done
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

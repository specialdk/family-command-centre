import React, { useState } from "react";

/* What a reminder opens onto. One task, two ways to answer it:

   - Done: one tap, ticked off.
   - Talk: Jade opens already knowing which task this is, and asks whether
     it is done or when it will be. "Yep, done" or "I'll do it at six" is
     the whole conversation.

   Built from Rhian's own sheet classes (.modal-backdrop, .sheet-card,
   .event-detail-sheet, .sheet-actions) rather than new ones. */

const when = (t) => {
  const fmt = (d, withTime) => new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(new Date(d));
  if (t.scheduledFor) return `On for ${fmt(t.scheduledFor, true)}`;
  if (t.dueAt) return `Due ${fmt(t.dueAt, true)}`;
  return "No time set";
};

export default function TaskCard({ task, onClose, onDone, onReopen, onEdit, onTalk }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const done = async () => {
    setBusy(true); setError("");
    try { await onDone(task); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">TO DO</p>

        {!task ? (
          <>
            <h2>That one's gone</h2>
            <p className="sheet-note">It may have been deleted since the reminder went out.</p>
            <div className="sheet-actions">
              <button type="button" className="chip-button" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h2>{task.title}</h2>
            <p className="sheet-note" style={{ marginTop: 4 }}>
              {[task.member?.name || "Unallocated", when(task)].join(" · ")}
            </p>
            {task.notes && <p style={{ margin: "10px 0 0" }}>{task.notes}</p>}

            {task.status === "DONE" ? (
              <>
                <p className="sheet-note" style={{ marginTop: 16 }}>Already ticked off. Nice.</p>
                <div className="sheet-actions">
                  {onReopen && (
                    <button type="button" className="chip-button" disabled={busy}
                      onClick={async () => { setBusy(true); try { await onReopen(task); onClose(); } catch (e) { setError(e.message); setBusy(false); } }}>
                      Not done — reopen
                    </button>
                  )}
                  <button type="button" className="chip-button" onClick={onClose}>Close</button>
                </div>
              </>
            ) : (
              <>
                {error && <div className="alert">{error}</div>}
                <div className="sheet-actions" style={{ marginTop: 18 }}>
                  {onEdit && (
                    <button type="button" className="chip-button" onClick={() => onEdit(task)} disabled={busy}>Edit</button>
                  )}
                  <button type="button" className="chip-button" onClick={() => onTalk(task)} disabled={busy}>
                    🎙 Talk to Jade
                  </button>
                  <button type="button" className="calendar-add-item" onClick={done} disabled={busy}>
                    {busy ? "Ticking off…" : "✓ Done"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
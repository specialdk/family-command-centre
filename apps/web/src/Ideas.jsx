import React, { useEffect, useState } from "react";

/* The ideas board. Cards show only the title and a line of about fifteen
   words; everything else - the fuller summary, the history of what was said
   and added, the tasks that came out of it - opens on tap.

   Most ideas arrive by voice: "Tell Jade an idea" opens Jade ready to listen,
   and "Continue with Jade" on a card picks a conversation up where it left
   off. Jade rewrites the card each time, so it always reads as the idea now. */

const STATUS = {
  NEW: { label: "New", tone: "var(--sky)" },
  DISCUSSING: { label: "Talking about it", tone: "var(--purple)" },
  PLANNED: { label: "Planned", tone: "var(--mint)" },
  DONE: { label: "Done", tone: "#7fbf8a" },
  PARKED: { label: "Parked", tone: "#98a0ad" },
};
const VIS = { FAMILY: { icon: "", label: "Whole family" }, PARENTS: { icon: "👪", label: "Parents only" }, PRIVATE: { icon: "🔒", label: "Just me" } };
const GROUPS = [
  { key: "active", label: "On the go", has: ["NEW", "DISCUSSING"] },
  { key: "planned", label: "Planned", has: ["PLANNED"] },
  { key: "closed", label: "Done and parked", has: ["DONE", "PARKED"] },
];
const day = (v) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(v));
const stamp = (v) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v));

function Chip({ status }) {
  const s = STATUS[status] || STATUS.NEW;
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap",
      color: s.tone, background: `color-mix(in srgb, ${s.tone} 14%, white)`
    }}>{s.label}</span>
  );
}

export default function Ideas({ api, viewer, members, version, onTalk }) {
  const [ideas, setIdeas] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = async () => {
    if (!viewer?.id) return;
    try { setIdeas(await api(`/api/ideas?viewer=${viewer.id}`)); setError(""); }
    catch (e) { setError(e.message); setIdeas([]); }
  };
  useEffect(() => { load(); }, [viewer?.id, version]);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="agenda-card">
        <div className="section-title">
          <h2>Ideas</h2>
          <button type="button" className="calendar-add-item" onClick={() => onTalk({ mode: "new" })}>🎙 Tell Jade an idea</button>
        </div>
        <p style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: 14 }}>
          Talk it out and Jade writes it up. Open a card to add to it, pick it back up, or turn it into tasks.
        </p>
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
      </section>

      {ideas === null && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      {ideas && !ideas.length && (
        <section className="task-card"><p style={{ color: "var(--muted)", margin: 0 }}>No ideas yet. Tap “Tell Jade an idea” and start talking.</p></section>
      )}

      {ideas && GROUPS.map((g) => {
        const items = ideas.filter((i) => g.has.includes(i.status));
        if (!items.length) return null;
        const collapsed = g.key === "closed" && !showClosed;
        return (
          <section key={g.key} className="task-card">
            <div className="section-title">
              <h2>{g.label}</h2>
              {g.key === "closed"
                ? <button type="button" onClick={() => setShowClosed((x) => !x)}>{showClosed ? "Hide" : `Show ${items.length}`}</button>
                : <span className="count-badge">{items.length}</span>}
            </div>
            {!collapsed && (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", marginTop: 12 }}>
                {items.map((i) => (
                  <button key={i.id} type="button" onClick={() => setOpenId(i.id)}
                    style={{
                      textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", borderRadius: 14,
                      background: "#fff", padding: "12px 14px", display: "grid", gap: 6, font: "inherit", color: "var(--ink)"
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
                      <strong style={{ fontSize: 15 }}>{VIS[i.visibility]?.icon ? `${VIS[i.visibility].icon} ` : ""}{i.title}</strong>
                      <Chip status={i.status} />
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>{i.shortLine}</span>
                    <small style={{ color: "#98a0ad", fontSize: 12 }}>
                      {[i.author?.name, day(i.updatedAt), i.taskCount ? `${i.taskCount} task${i.taskCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {openId && (
        <IdeaSheet
          id={openId} api={api} viewer={viewer} members={members}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onTalk={(idea) => { setOpenId(null); onTalk(idea); }}
        />
      )}
    </div>
  );
}

function IdeaSheet({ id, api, viewer, onClose, onChanged, onTalk }) {
  const [idea, setIdea] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    try { setIdea(await api(`/api/ideas/${id}?viewer=${viewer?.id ?? ""}`)); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [id]);

  const isAuthor = idea && viewer?.id === idea.authorId;
  const isParent = viewer?.role === "PARENT";

  const act = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); await load(); onChanged(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  const patch = (data) => act(() => api(`/api/ideas/${id}`, { method: "PATCH", body: JSON.stringify({ ...data, actorId: viewer?.id }) }));
  const addNote = () => act(async () => {
    await api(`/api/ideas/${id}/notes`, { method: "POST", body: JSON.stringify({ text: note, actorId: viewer?.id }) });
    setNote("");
  });
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/ideas/${id}`, { method: "DELETE", body: JSON.stringify({ actorId: viewer?.id }) });
      onChanged(); onClose();
    } catch (e) { setError(e.message); setBusy(false); setConfirming(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        {!idea ? (
          <p style={{ color: "var(--muted)" }}>{error || "Loading…"}</p>
        ) : (
          <>
            <p className="eyebrow">IDEA · {idea.author?.name || "Someone"} · {day(idea.createdAt)}</p>
            <h2>{idea.title}</h2>
            <p style={{ margin: "6px 0 0", lineHeight: 1.5 }}>{idea.summary || idea.shortLine}</p>

            <div className="sheet-row" style={{ marginTop: 14 }}>
              <label>Status
                <select value={idea.status} disabled={busy || (!isAuthor && !isParent)} onChange={(e) => patch({ status: e.target.value })}>
                  {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                </select>
              </label>
              <label>Who can see it
                <select value={idea.visibility} disabled={busy || !isAuthor} onChange={(e) => patch({ visibility: e.target.value })}>
                  {Object.entries(VIS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
            </div>

            <div className="sheet-actions" style={{ marginTop: 14, justifyContent: "flex-start" }}>
              <button type="button" className="calendar-add-item" disabled={busy}
                onClick={() => onTalk({ id: idea.id, title: idea.title })}>🎙 Continue with Jade</button>
            </div>
            {isAuthor && (
              <p className="sheet-note" style={{ marginTop: 6 }}>
                To turn it into tasks, continue with Jade and ask her to — you'll get the list to approve first.
              </p>
            )}

            <label style={{ marginTop: 14, display: "block" }}>Add a note
              <div style={{ display: "flex", gap: 8 }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Maddie can't do the first week" style={{ flex: 1 }} />
                <button type="button" className="chip-button" disabled={busy || !note.trim()} onClick={addNote}>
                  {busy ? "Adding…" : "Add"}
                </button>
              </div>
            </label>

            {idea.tasks?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="eyebrow">TASKS FROM THIS IDEA</p>
                {idea.tasks.map((t) => (
                  <p key={t.id} style={{ margin: "6px 0", fontSize: 14 }}>
                    {t.status === "DONE" ? "✓ " : "□ "}<span style={t.status === "DONE" ? { textDecoration: "line-through", color: "#98a0ad" } : undefined}>{t.title}</span>
                    <span style={{ color: "var(--muted)" }}> · {t.member?.name || "Unallocated"}</span>
                  </p>
                ))}
              </div>
            )}

            {idea.entries?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="eyebrow">HISTORY</p>
                {idea.entries.map((e) => (
                  e.kind === "CONVERSATION" ? (
                    <details key={e.id} style={{ margin: "8px 0" }}>
                      <summary style={{ cursor: "pointer", fontSize: 14 }}>
                        🎙 Conversation · {e.author?.name || "Someone"} · {stamp(e.createdAt)}
                      </summary>
                      <p style={{ whiteSpace: "pre-line", fontSize: 13, color: "var(--muted)", margin: "6px 0 0 18px" }}>{e.text}</p>
                    </details>
                  ) : (
                    <p key={e.id} style={{ margin: "8px 0", fontSize: 14 }}>
                      📝 {e.text} <span style={{ color: "#98a0ad", fontSize: 12 }}>· {e.author?.name || "Someone"} · {stamp(e.createdAt)}</span>
                    </p>
                  )
                ))}
              </div>
            )}

            {error && <div className="alert">{error}</div>}

            <div className="sheet-actions" style={{ marginTop: 16 }}>
              {(isAuthor || isParent) && (confirming ? (
                <>
                  <span className="sheet-confirm">Delete this idea for everyone?</span>
                  <button type="button" className="chip-button" onClick={() => setConfirming(false)}>Keep it</button>
                  <button type="button" className="danger-button" onClick={remove} disabled={busy}>Yes, delete</button>
                </>
              ) : (
                <button type="button" className="danger-ghost" onClick={() => setConfirming(true)}>Delete</button>
              ))}
              {!confirming && <button type="button" className="chip-button" onClick={onClose}>Close</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

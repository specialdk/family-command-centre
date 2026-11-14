import React, { useEffect, useMemo, useState } from "react";

/* Tasks v2 - the accountability screen.

   Top: where everyone stands. On a desktop that is a table, one row per
   person, a column per urgency; every number is a filter. On a phone the
   same thing is a strip of counts for yourself, or one line per person when
   a parent widens it to Everyone.

   Below: the tasks themselves, grouped by urgency. A row opens the task
   card; only the circle ticks it off, so a stray tap cannot undo anything.

   Chores (repeating tasks) are deliberately not here yet: ticking one off
   currently marks it done for good, so they join once each occurrence can
   be done on its own. */

const DAY = 86400000;
const TONE = { overdue: "var(--coral)", today: "var(--sun)", week: "var(--sky)" };
const GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "today",   label: "Today" },
  { key: "week",    label: "This week" },
  { key: "later",   label: "Later" },
  { key: "none",    label: "No date" },
];

export const whenOf = (t) => t.scheduledFor || t.dueAt || null;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

export function bucket(t, now) {
  /* A missed deadline is overdue even if a later time has been pencilled in
     to catch up - it stays visibly late until it's done. */
  if (t.dueAt && endOfDay(t.dueAt) < now) return "overdue";   // "due Saturday" means by the end of Saturday
  const w = whenOf(t);
  if (!w) return "none";
  const d = new Date(w);
  if (d < now) return "overdue";
  const today = startOfDay(now);
  if (d < new Date(today.getTime() + DAY)) return "today";
  if (d < new Date(today.getTime() + 7 * DAY)) return "week";
  return "later";
}

const fmtWhen = (t) => {
  const bits = [];
  const f = (v, time) => new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(new Date(v));
  const late = t.dueAt && endOfDay(t.dueAt) < new Date();
  if (late) bits.push(`Due ${f(t.dueAt, false)}`);
  if (t.scheduledFor) bits.push(late ? `planned ${f(t.scheduledFor, true)}` : f(t.scheduledFor, true));
  if (t.dueAt && !late) bits.push(`due ${f(t.dueAt, false)}`);
  return bits.join(" · ");
};

const usePhone = () => {
  const q = "(max-width: 700px)";
  const [phone, setPhone] = useState(() => { try { return window.matchMedia(q).matches; } catch { return false; } });
  useEffect(() => {
    try {
      const mq = window.matchMedia(q);
      const on = (e) => setPhone(e.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch { return undefined; }
  }, []);
  return phone;
};

const cellStyle = { padding: "8px 10px", textAlign: "center", borderTop: "1px solid var(--line)" };
const numButton = (hot, active) => ({
  border: 0, borderRadius: 8, minWidth: 34, padding: "4px 8px", cursor: "pointer",
  fontWeight: 800, fontSize: 15,
  background: active ? "var(--navy)" : hot ? "color-mix(in srgb, var(--coral) 16%, white)" : "transparent",
  color: active ? "#fff" : hot ? "var(--coral)" : "var(--ink)",
});

export default function TasksBoard({ tasks, members, viewer, everyone, onOpen, onToggle, onAdd, scopeToggle = null }) {
  const phone = usePhone();
  const [filter, setFilter] = useState(null);   // { memberId, group } - either may be undefined
  /* Who has a phone set up for reminders. A reminder to someone with no
     device goes nowhere, silently - so say so where the parents look. */
  const [reachable, setReachable] = useState(null);
  useEffect(() => {
    fetch("/api/push/devices", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setReachable(new Set(list.map((d) => d.memberId))))
      .catch(() => setReachable(null));
  }, [tasks]);
  const noPhone = (id) => id != null && reachable && !reachable.has(id);
  const now = new Date();

  // Who appears: everyone (parents widening the view) or just the viewer.
  const people = useMemo(() => {
    const list = everyone ? [...members] : members.filter((m) => m.id === viewer?.id);
    if (everyone) list.push({ id: null, name: "Unallocated", initials: "–" });
    return list;
  }, [members, viewer, everyone]);

  const visible = tasks.filter((t) => t.kind === "TASK" || !t.kind)
    .filter((t) => everyone || t.memberId === viewer?.id || !t.memberId);
  const open = visible.filter((t) => t.status === "OPEN");
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const doneWeek = visible.filter((t) => t.status === "DONE" && t.completedAt && new Date(t.completedAt) >= weekAgo);

  const count = (memberId, group) => {
    if (group === "done") return doneWeek.filter((t) => (t.memberId ?? null) === memberId).length;
    return open.filter((t) => (t.memberId ?? null) === memberId && bucket(t, now) === group).length;
  };
  const helpFor = (memberId) => open.some((t) => (t.memberId ?? null) === memberId && t.needsHelp);
  const pick = (memberId, group) => {
    const same = filter && filter.memberId === memberId && filter.group === group;
    setFilter(same ? null : { memberId, group });
  };

  // The list underneath, honouring the filter.
  const listed = open.filter((t) =>
    (!filter || filter.memberId === undefined || (t.memberId ?? null) === filter.memberId) &&
    (!filter || !filter.group || bucket(t, now) === filter.group));
  const showDone = filter?.group === "done";
  const doneListed = doneWeek.filter((t) => !filter || filter.memberId === undefined || (t.memberId ?? null) === filter.memberId);

  const cols = [...GROUPS.filter((g) => g.key !== "none"), { key: "done", label: "Done this week" }];
  const nameOf = (id) => id == null ? "Unallocated" : (members.find((m) => m.id === id)?.name || "Someone");

  return (
    <div style={{ display: "grid", gap: phone ? 14 : 18 }}>
      {/* ---------------- overview ---------------- */}
      <section className="agenda-card" style={phone ? { padding: "14px 14px 12px" } : undefined}>
        {phone ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 20, flex: 1 }}>{everyone ? "Everyone's tasks" : "My tasks"}</h2>
            {scopeToggle}
            <button type="button" className="calendar-add-item" onClick={onAdd} aria-label="Add a task"
              style={{ width: 38, height: 38, padding: 0, borderRadius: 12, fontSize: 22, justifyContent: "center" }}>＋</button>
          </div>
        ) : (
        <div className="section-title">
          <h2>{everyone ? "Where everyone is at" : "Where you're at"}</h2>
          <button type="button" className="calendar-add-item" onClick={onAdd}>+ Add task</button>
        </div>
        )}

        {!phone && (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--muted)" }} />
                  {cols.map((c) => (
                    <th key={c.key} style={{ padding: "6px 10px", color: c.key === "overdue" ? "var(--coral)" : "var(--muted)", fontWeight: 800 }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id ?? "none"}>
                    <td style={{ ...cellStyle, textAlign: "left", fontWeight: 800, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => pick(p.id, undefined)}
                        style={{ border: 0, background: "none", font: "inherit", cursor: "pointer", color: "var(--ink)" }}>
                        {p.name}{helpFor(p.id) && <span title="Has asked for help" style={{ marginLeft: 6 }}>🙋</span>}
                        {noPhone(p.id) && <span title="No phone set up for reminders - they won't get any" style={{ marginLeft: 6, fontSize: 11, color: "var(--coral)", fontWeight: 700 }}>📵 no phone</span>}
                      </button>
                    </td>
                    {cols.map((c) => {
                      const n = count(p.id, c.key);
                      const active = filter?.memberId === p.id && filter?.group === c.key;
                      return (
                        <td key={c.key} style={cellStyle}>
                          {n > 0
                            ? <button type="button" style={numButton(c.key === "overdue", active)} onClick={() => pick(p.id, c.key)}>{n}</button>
                            : <span style={{ color: "#c3c7d0" }}>–</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {phone && !everyone && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {GROUPS.filter((g) => g.key !== "none" && g.key !== "later").map((g) => {
              const n = count(viewer?.id ?? null, g.key) + (g.key !== "done" ? count(null, g.key) : 0);
              const active = filter?.group === g.key;
              return (
                <button key={g.key} type="button" className="chip-button" onClick={() => setFilter(active ? null : { group: g.key })}
                  style={active ? { background: "var(--navy)", color: "#fff" }
                    : { ...(TONE[g.key] && (n || g.key !== "overdue") ? { background: `color-mix(in srgb, ${TONE[g.key]} ${g.key === "overdue" ? 18 : 22}%, white)`, borderColor: `color-mix(in srgb, ${TONE[g.key]} 45%, white)` } : {}),
                        ...(g.key === "overdue" && n ? { color: "var(--coral)", fontWeight: 900 } : {}) }}>
                  {g.label} {n}
                </button>
              );
            })}
          </div>
        )}

        {phone && everyone && (
          <div className="connection-list" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {people.map((p) => {
              const o = count(p.id, "overdue"), d = count(p.id, "today");
              const active = filter?.memberId === p.id && !filter?.group;
              return (
                <button key={p.id ?? "none"} type="button" className="chip-button" onClick={() => pick(p.id, undefined)}
                  style={{ display: "grid", gap: 2, justifyItems: "start", textAlign: "left", width: "100%", padding: "8px 12px", ...(active ? { background: "var(--navy)", color: "#fff" } : {}) }}>
                  <span>{p.name}{helpFor(p.id) ? " 🙋" : ""}{noPhone(p.id) ? " 📵" : ""}</span>
                  <span style={{ fontSize: 12, color: active ? "#fff" : o ? "var(--coral)" : "var(--muted)" }}>
                    {[o && `${o} overdue`, d && `${d} today`].filter(Boolean).join(" · ") || "all clear"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {filter && (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Showing {filter.group ? (cols.find((c) => c.key === filter.group)?.label || "").toLowerCase() : "all"}
            {filter.memberId !== undefined ? ` for ${nameOf(filter.memberId)}` : ""} ·{" "}
            <button type="button" onClick={() => setFilter(null)}
              style={{ border: 0, background: "none", color: "var(--navy)", fontWeight: 800, cursor: "pointer", padding: 0 }}>
              show everything
            </button>
          </p>
        )}
      </section>

      {/* ---------------- the list ---------------- */}
      {showDone ? (
        <TaskGroup title="Done this week" items={doneListed} members={members} onOpen={onOpen} onToggle={onToggle} done flat={phone} showName={(t) => everyone || t.memberId !== viewer?.id} />
      ) : (
        GROUPS.map((g) => {
          const items = listed.filter((t) => bucket(t, now) === g.key)
            .sort((a, b) => new Date(whenOf(a) || 0) - new Date(whenOf(b) || 0));
          if (!items.length) return null;
          return <TaskGroup key={g.key} title={g.label} hot={g.key === "overdue"} items={items} members={members} onOpen={onOpen} onToggle={onToggle}
                            flat={phone} showName={(t) => everyone || t.memberId !== viewer?.id} />;
        })
      )}
      {!showDone && !listed.length && (
        <section className="task-card"><p style={{ color: "var(--muted)", margin: 0 }}>Nothing outstanding. 🎉</p></section>
      )}
    </div>
  );
}

/* On a phone the groups are headings on the page, not heavy cards - and only
   Overdue gets colour, so the eye goes there first. */
function TaskGroup({ title, items, hot, done, onOpen, onToggle, flat, showName = () => true }) {
  return (
    <section className={flat ? undefined : "task-card"}
      style={flat ? (hot ? { background: "color-mix(in srgb, var(--coral) 8%, white)", border: "1px solid color-mix(in srgb, var(--coral) 35%, white)", borderRadius: 18, padding: "12px 10px 6px" } : { padding: "0 2px" }) : undefined}>
      {flat ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 6px" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, letterSpacing: ".02em", color: hot ? "var(--coral)" : "var(--muted)", flex: 1 }}>{title}</h3>
          <span style={{ fontSize: 13, fontWeight: 900, color: hot ? "var(--coral)" : "var(--muted)" }}>{items.length}</span>
        </div>
      ) : (
      <div className="section-title">
        <h2 style={hot ? { color: "var(--coral)" } : undefined}>{title}</h2>
        <span className="count-badge">{items.length}</span>
      </div>
      )}
      <div className="today-task-list" style={flat ? { marginTop: 0 } : undefined}>
        {items.map((t) => (
          <button key={t.id} onClick={() => onOpen(t)}>
            <span className="task-check" title={done ? "Reopen" : "Tick off"}
              style={done ? { background: "#7fbf8a", borderColor: "#7fbf8a" } : undefined}
              onClick={(ev) => { ev.stopPropagation(); onToggle(t); }}>{done ? "✓" : ""}</span>
            <div>
              <strong style={done ? { color: "#98a0ad", textDecoration: "line-through" } : undefined}>
                {t.title}{t.needsHelp && <span title="Asked for help" style={{ marginLeft: 6 }}>🙋</span>}
              </strong>
              <small style={hot ? { color: "var(--coral)" } : undefined}>{[showName(t) ? (t.member?.name || "Unallocated") : null, fmtWhen(t)].filter(Boolean).join(" · ")}</small>
            </div>
            <span style={{ color: "#c3c7d0" }}>›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- editor --
   One sheet for adding and editing. Anyone can add a task for anyone - a
   child can ask a parent to sign a permission slip. Only a parent can
   delete one. */

const pad = (n) => String(n).padStart(2, "0");
const toDate = (v) => { if (!v) return ""; const d = new Date(v); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toTime = (v) => { if (!v) return ""; const d = new Date(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function TaskSheet({ task, members, viewer, onCancel, onSave, onDelete }) {
  const editing = Boolean(task?.id);
  const [d, setD] = useState(() => ({
    title: task?.title || "",
    notes: task?.notes || "",
    memberId: task ? (task.memberId ?? "") : (viewer?.id ?? ""),
    date: toDate(task?.scheduledFor),
    time: toTime(task?.scheduledFor),
    due: toDate(task?.dueAt),
    reminderMins: task?.reminderMins ?? "",
    needsHelp: Boolean(task?.needsHelp),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const set = (p) => setD((x) => ({ ...x, ...p }));
  const isParent = viewer?.role === "PARENT";

  const submit = async (e) => {
    e.preventDefault();
    if (!d.title.trim()) return setError("Give it a name.");
    if (d.time && !d.date) return setError("Pick a day for that time.");
    setBusy(true); setError("");
    const payload = {
      title: d.title.trim(),
      notes: d.notes.trim() || null,
      memberId: d.memberId === "" ? null : Number(d.memberId),
      scheduledFor: d.date ? new Date(`${d.date}T${d.time || "09:00"}`).toISOString() : null,
      dueAt: d.due ? new Date(`${d.due}T17:00`).toISOString() : null,
      reminderMins: d.reminderMins === "" ? null : Number(d.reminderMins),
      needsHelp: d.needsHelp,
    };
    try { await onSave(task?.id ?? null, payload); onCancel(); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError("");
    try { await onDelete(task.id); onCancel(); }
    catch (err) { setError(err.message); setBusy(false); setConfirming(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <p className="eyebrow">{editing ? "EDIT TO DO" : "NEW TO DO"}</p>
        <h2>{editing ? task.title : "Something to do"}</h2>

        <label>What needs doing?
          <input value={d.title} autoFocus={!editing} onChange={(e) => set({ title: e.target.value })}
                 placeholder="e.g. Take the bins out" />
        </label>

        <div className="sheet-row">
          <label>Who
            <select value={d.memberId} onChange={(e) => set({ memberId: e.target.value })}>
              <option value="">Unallocated</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Remind
            <select value={d.reminderMins} onChange={(e) => set({ reminderMins: e.target.value })}>
              <option value="">Family default</option>
              <option value="0">At the time</option>
              <option value="5">5 minutes before</option>
              <option value="15">15 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
              <option value="-1">No reminder</option>
            </select>
          </label>
        </div>

        <div className="sheet-row">
          <label>Do it on
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} />
          </label>
          <label>At
            <input type="time" value={d.time} disabled={!d.date} onChange={(e) => set({ time: e.target.value })} />
          </label>
          <label>Due by <small>(optional)</small>
            <input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} />
          </label>
        </div>

        <label>Notes <small>(optional)</small>
          <input value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anything worth knowing" />
        </label>

        <label className="sheet-check">
          <input type="checkbox" checked={d.needsHelp} onChange={(e) => set({ needsHelp: e.target.checked })} />
          🙋 Needs help with this
        </label>

        {error && <div className="alert">{error}</div>}

        <div className="sheet-actions">
          {editing && isParent && (confirming ? (
            <>
              <span className="sheet-confirm">Delete it for everyone?</span>
              <button type="button" className="chip-button" onClick={() => setConfirming(false)}>Keep it</button>
              <button type="button" className="danger-button" onClick={remove} disabled={busy}>Yes, delete</button>
            </>
          ) : (
            <button type="button" className="danger-ghost" onClick={() => setConfirming(true)}>Delete</button>
          ))}
          {!confirming && (
            <>
              <button type="button" className="chip-button" onClick={onCancel}>Cancel</button>
              <button type="submit" className="calendar-add-item" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save changes" : "Add it"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

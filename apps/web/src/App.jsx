import React, { useEffect, useMemo, useState } from "react";
import Calendar from "./Calendar.jsx";

/* Nav mirrors Rhian's prototype. `ready` marks modules the API can serve today;
   the rest render an honest placeholder rather than fake data. */
const NAV = [
  { key: "today",       emoji: "🏠",        label: "Today",       ready: true, today: true, primary: true },
  { key: "calendar",    emoji: "🗓️",        label: "Calendar",    ready: true, primary: true },
  { key: "tasks",       emoji: "✅",        label: "Tasks",       ready: true, primary: true },
  { key: "family",      emoji: "👨‍👩‍👧‍👦", label: "Family",      ready: true, parentOnly: true },
  { key: "recipes",     emoji: "🍲",        label: "Recipes",     ready: true },
  { key: "ideas",       emoji: "💡",        label: "Ideas" },
  { key: "inputs",      emoji: "📥",        label: "Inputs",      parentOnly: true },
  { key: "finances",    emoji: "💰",        label: "Finances",    parentOnly: true },
  { key: "investments", emoji: "📈",        label: "Investments", parentOnly: true },
  { key: "shopping",    emoji: "🛒",        label: "Shopping",    ready: true, primary: true },
  { key: "how",         emoji: "?",         label: "How do I" },
  { key: "uploads",     emoji: "＋",        label: "Uploads" }
];

const PLACEHOLDER = {
  ideas:       "Somewhere to park the things the family half-decides — trips, projects, birthday plans — before they become tasks.",
  inputs:      "Bank statements, receipts and documents get dropped here, then read and filed automatically.",
  finances:    "Budget versus actual, and the handful of things worth looking at, without opening the whole spreadsheet.",
  investments: "Holdings, super and the weekly movement, summarised rather than dumped.",
  how:         "Short answers to the household questions nobody can ever remember the answer to.",
  uploads:     "A single place to add anything — a photo of a recipe, a receipt, a school note."
};

/* Who you last looked at the app as. A convenience, not a credential —
   it is a view, not a permission boundary. Real per-person auth arrives
   with Microsoft sign-in. */
const VIEWER_KEY = "fcc.viewer";
const rememberViewer = (id) => { try { localStorage.setItem(VIEWER_KEY, String(id)); } catch {} };
const recallViewer = () => { try { return localStorage.getItem(VIEWER_KEY) || ""; } catch { return ""; } };

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
};

const timeOf = (v) => v
  ? new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(new Date(v))
  : "Unscheduled";
const dayOf = (v) => v
  ? new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" }).format(new Date(v))
  : "No date";
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const personClass = (member, members) => {
  if (!member) return "person-family";
  const known = ["rhian", "danielle", "lachie", "jack", "maddie"];
  const name = member.name.toLowerCase();
  return known.includes(name) ? `person-${name}` : "person-family";
};

export default function App() {
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState("");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("today");
  const [viewingId, setViewingId] = useState(recallViewer);
  const [scope, setScope] = useState("mine");   // "mine" | "everyone"
  const [composing, setComposing] = useState(false);
  const [history, setHistory]     = useState(null);   // null = closed
  const [moreOpen, setMoreOpen]   = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => setData(await api("/api/dashboard"));

  useEffect(() => {
    api("/api/session")
      .then((s) => { setSession(s.authenticated); if (s.authenticated) return load(); })
      .catch(() => setSession(false));
  }, []);

  const mutate = async (fn) => {
    setSaving(true);
    try { await fn(); await load(); }
    catch (e) { setMessage(e.message); }
    finally { setSaving(false); }
  };

  const login = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      setSession(true); setPassword(""); await load();
    } catch (e) { setMessage(e.message); }
  };

  const logout = async () => {
    await api("/api/logout", { method: "POST" });
    setSession(false); setData(null);
  };

  const toggleTask = (t) => mutate(() => api(`/api/tasks/${t.id}`, {
    method: "PATCH", body: JSON.stringify({ status: t.status === "DONE" ? "OPEN" : "DONE" })
  }));
  const toggleChore = (c) => mutate(() => api(`/api/chores/${c.id}`, {
    method: "PATCH", body: JSON.stringify({ completed: !c.completed })
  }));
  // actorId rides along so a notice can say who did it.
  const createEvent = async (payload) => {
    await api("/api/events", { method: "POST", body: JSON.stringify({ ...payload, actorId: viewer?.id }) });
    await load();
  };
  const updateEvent = async (id, payload) => {
    await api(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify({ ...payload, actorId: viewer?.id }) });
    await load();
  };
  const deleteEvent = async (id) => {
    await api(`/api/events/${id}`, { method: "DELETE", body: JSON.stringify({ actorId: viewer?.id }) });
    await load();
  };
  const openHistory = async () => {
    setHistory([]);                                   // open immediately, fill when it lands
    try { setHistory(await api("/api/notifications?limit=200")); }
    catch (e) { setMessage(e.message); setHistory(null); }
  };
  /* Scheduling from the rail: when it happens, and whose it is, in one go. */
  const scheduleTask = async (task, whenISO, memberId) => {
    const url = `/api/tasks/${task.id}`;
    await api(url, {
      method: "PATCH",
      body: JSON.stringify({ scheduledFor: whenISO, memberId: memberId ?? task.memberId ?? null, actorId: viewer?.id })
    });
    await load();
  };

  const postNotice = async (title, body) => {
    await api("/api/notifications", { method: "POST", body: JSON.stringify({ title, body, authorId: viewer?.id }) });
    await load();
  };
  const markNoticesRead = async (ids) => {
    if (!viewer?.id || !ids?.length) return;
    await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ memberId: viewer.id, ids }) });
    await load();
  };

  const toggleShopping = (i) => mutate(() => api(`/api/shopping/${i.id}`, {
    method: "PATCH", body: JSON.stringify({ checked: !i.checked })
  }));

  const viewer = useMemo(
    () => data?.members?.find((m) => String(m.id) === String(viewingId)) || data?.members?.[0],
    [data, viewingId]
  );
  const isParent = viewer?.role === "PARENT";
  // Children always see their own view; only a parent may widen it.
  const everyone = isParent && scope === "everyone";

  /* Unassigned items belong to the whole household, so they stay visible to
     everyone — that is what makes the Unallocated queue work. */
  const mine = (x) => everyone || !x.memberId || x.memberId === viewer?.id;

  const openTasks = useMemo(() => (data?.tasks || []).filter((t) => t.status === "OPEN" && mine(t)), [data, viewer, everyone]);
  const doneTasks = useMemo(() => (data?.tasks || []).filter((t) => t.status === "DONE" && mine(t)), [data, viewer, everyone]);
  const myChores  = useMemo(() => (data?.chores || []).filter(mine), [data, viewer, everyone]);
  const scopedEvents = useMemo(() => (data?.events || []).filter(mine), [data, viewer, everyone]);
  /* Tasks and routines both land on the calendar when they have a time. */
  const scheduled = useMemo(
    () => [...(data?.tasks || []), ...(data?.chores || [])].filter(mine),
    [data, viewer, everyone]
  );

  /* A notice with no member is for the whole family. Unread is per person,
     which is what lets the card say "everyone is up to date". */
  const notices = useMemo(
    () => (data?.notifications || []).filter((nt) => !nt.memberId || nt.memberId === viewer?.id),
    [data, viewer]
  );
  const unread = useMemo(
    () => notices.filter((nt) => !(nt.reads || []).some((r) => r.memberId === viewer?.id)),
    [notices, viewer]
  );
  const upcoming  = useMemo(() =>
    scopedEvents.filter((e) => new Date(e.endsAt) >= new Date())
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)), [scopedEvents]);

  // Switching to a child while on a parent-only tab must not strand them there.
  useEffect(() => {
    if (!viewer) return;
    const t = NAV.find((n) => n.key === tab);
    if (t?.parentOnly && viewer.role !== "PARENT") setTab("today");
  }, [viewer, tab]);

  if (session === null) return <div className="splash">Opening Family Command Centre…</div>;

  if (!session) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={login}>
          <span>🏠</span>
          <h1>Family Command Centre</h1>
          <p>Private family access</p>
          <label>
            Family password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <button type="submit">Open dashboard</button>
          {message && <div className="alert">{message}</div>}
        </form>
      </main>
    );
  }

  if (!data) return <div className="splash">Loading family dashboard…</div>;

  const nav      = NAV.filter((item) => isParent || !item.parentOnly);
  const current  = nav.find((n) => n.key === tab) || nav[0];
  const parents  = data.members.filter((m) => m.role === "PARENT").slice(0, 2);

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <div className="brand-mark"><span style={{ fontSize: 26 }}>🏡</span></div>
        <nav>
          <div className="sortable-nav">
            {nav.map((item) => (
              <button
                key={item.key}
                className={[
                  item.today ? "today-nav" : "",
                  item.primary ? "nav-primary" : "nav-secondary",
                  tab === item.key ? "active" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => setTab(item.key)}
                title={item.label}
              >
                {item.today && <em>HOME</em>}
                <span>{item.emoji}</span>
                <small>{item.label}</small>
                {!item.today && <i className="nav-grip">⋮⋮</i>}
              </button>
            ))}
            {/* Shown only on small screens; the other eight live behind it. */}
            <button
              className={`nav-more ${nav.some((i) => !i.primary && i.key === tab) ? "active" : ""}`}
              onClick={() => setMoreOpen(true)}
              title="More"
            >
              <span>⋯</span>
              <small>More</small>
            </button>
          </div>
        </nav>
        <button className="avatar-button" onClick={logout} title="Sign out">
          {viewer?.initials || "—"}
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">FAMILY COMMAND CENTRE</p>
            <h1>{current.label}</h1>
          </div>
          <div className="topbar-actions">
            <div className="profile-picker">
              Viewing as
              <select
                value={viewer?.id ?? ""}
                onChange={(e) => { setViewingId(e.target.value); rememberViewer(e.target.value); setScope("mine"); }}
              >
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {isParent && (
              <div className="view-switch">
                <button className={scope === "mine" ? "selected" : ""} onClick={() => setScope("mine")}>Just me</button>
                <button className={scope === "everyone" ? "selected" : ""} onClick={() => setScope("everyone")}>Everyone</button>
              </div>
            )}
            <button
              className="round-button" title={unread.length ? `${unread.length} new` : "Nothing new"}
              onClick={() => setTab("today")}
            >
              🔔{unread.length > 0 && <span className="notification-dot" />}
            </button>
            <button className="round-button settings-button" title="Settings">⚙</button>
            <button className="voice-button" onClick={() => setMessage("Sol is not connected yet.")}>
              <span className="voice-mark"><i /><i /><i /><i /></span>
              Talk to Sol
            </button>
            <div className="parent-stack">
              {parents.map((p) => <span key={p.id}>{p.initials?.[0] || "?"}</span>)}
            </div>
          </div>
        </header>

        <div className="status-strip">
          <span className={saving ? "status-pulse saving" : "status-pulse"} />
          {openTasks.length} open {openTasks.length === 1 ? "task" : "tasks"} · {upcoming.length} upcoming
          <span className="status-meta">
            {everyone ? "Whole family" : `${viewer?.name || "Personal"}'s view`}
            {isParent ? " · parent" : ""} · {saving ? "Saving…" : "Saved"}
          </span>
        </div>

        <div className="page-body">
          {message && <div className="alert" style={{ marginBottom: 18 }}>{message}</div>}

          {tab === "today" && (
            <Notices
              unread={unread} members={data.members} viewer={viewer}
              onCompose={() => setComposing(true)} onRead={markNoticesRead} onHistory={openHistory}
            />
          )}

          {tab === "today" && (
            <Today
              viewing={viewer} members={data.members} upcoming={upcoming}
              openTasks={openTasks} chores={myChores}
              toggleTask={toggleTask} toggleChore={toggleChore} onSeeAll={() => setTab("calendar")}
            />
          )}
          {tab === "calendar" && (
            <Calendar
              events={scopedEvents} tasks={scheduled} members={data.members} calendars={data.calendars || []}
              viewer={viewer} onCreate={createEvent} onUpdate={updateEvent} onDelete={deleteEvent}
              onToggleTask={(t) => (t.kind && t.kind !== "TASK") ? toggleChore(t) : toggleTask(t)}
              onSchedule={scheduleTask}
            />
          )}
          {tab === "tasks"    && <Tasks open={openTasks} done={doneTasks} members={data.members} toggle={toggleTask} />}
          {tab === "family"   && <Family members={data.members} tasks={data.tasks} />}
          {tab === "recipes"  && <Recipes meals={data.meals} />}
          {tab === "shopping" && <Shopping items={data.shopping} toggle={toggleShopping} />}
          {!current.ready && <Placeholder item={current} />}
        </div>
      </div>

      {moreOpen && (
        <MoreSheet
          items={nav.filter((i) => !i.primary)} current={tab}
          onPick={(k) => { setTab(k); setMoreOpen(false); }}
          onCancel={() => setMoreOpen(false)}
          onSignOut={logout}
        />
      )}
      {composing && <NoticeComposer onCancel={() => setComposing(false)} onSend={postNotice} />}
      {history !== null && <HistorySheet notices={history} members={data.members} viewer={viewer} onCancel={() => setHistory(null)} />}
    </div>
  );
}

function MoreSheet({ items, current, onPick, onCancel, onSignOut }) {
  /* Sign out lives here on a phone. The bottom bar has five slots and a
     sign-out button is not worth one of them; it also kept the bar 42px
     wider than the screen, which is how it ended up in this sheet. */
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="notification-sheet more-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">GO TO</p>
        <h2>Everything else</h2>
        <div className="more-grid">
          {items.map((i) => (
            <button key={i.key} className={current === i.key ? "active" : ""} onClick={() => onPick(i.key)}>
              <span>{i.emoji}</span>{i.label}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="chip-button" onClick={onCancel}>Close</button>
          {onSignOut && (
            <button type="button" className="chip-button" onClick={onSignOut}>Sign out</button>
          )}
        </div>
      </div>
    </div>
  );
}

const sinceLabel = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

function Notices({ unread, members, viewer, onCompose, onRead, onHistory }) {
  /* A notice is an announcement: once everyone has seen it, it has done its
     job and leaves the card. Nothing is deleted - it moves to the history,
     which is the record. The card is allowed to be empty; "everyone is up to
     date" should be a real resting state, not a heading over old news. */
  const shown = useMemo(() => unread.slice(0, 8), [unread]);

  /* Marked read because they were on screen, not because a bell was tapped.
     That is what makes the receipts mean anything. Dropping off happens on
     the next load rather than live, so nothing vanishes while being read. */
  const shownUnreadIds = shown.map((nt) => nt.id).join(",");
  useEffect(() => {
    if (!shownUnreadIds) return;
    const t = setTimeout(() => onRead(shownUnreadIds.split(",").map(Number)), 2500);
    return () => clearTimeout(t);
  }, [shownUnreadIds]);

  return (
    <section className="family-notifications">
      <div className="family-notification-heading">
        <div>
          <p className="eyebrow">FAMILY NOTIFICATIONS</p>
          <h2>{unread.length ? `${unread.length} new` : "Everyone is up to date"}</h2>
        </div>
        <div className="notice-head-actions">
          <button className="notice-history-link" onClick={onHistory}>Recent activity →</button>
          <button className="family-notify-button" onClick={onCompose}>＋<span>Notify family</span></button>
        </div>
      </div>
      {shown.map((nt) => (
        <article key={nt.id}>
          <span className="notice-icon">{nt.kind === "FAMILY_NOTICE" ? "📣" : "🔄"}</span>
          <div>
            <strong>{nt.title}</strong>
            <small>{[nt.body, nt.author?.name, sinceLabel(nt.createdAt)].filter(Boolean).join(" · ")}</small>
            <ReadBy notice={nt} members={members} viewer={viewer} />
          </div>
          <span className="notice-new">New</span>
        </article>
      ))}
    </section>
  );
}

/// The history: every notice ever raised, newest first, using Rhian's
/// .timeline shape - when, a dot, what happened.
function HistorySheet({ notices, members, viewer, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="notification-sheet history-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">RECENT ACTIVITY</p>
        <h2>What has been happening</h2>
        <div className="history-scroll">
          <div className="timeline">
            {notices.map((nt) => (
              <article key={nt.id}>
                <time>{sinceLabel(nt.createdAt)}</time>
                <span className="timeline-dot" style={{ color: nt.kind === "FAMILY_NOTICE" ? "var(--purple)" : "var(--sky)" }} />
                <div>
                  <strong>{nt.title}</strong>
                  <small>{[nt.body, nt.author ? `by ${nt.author.name}` : null].filter(Boolean).join(" · ")}</small>
                  <ReadBy notice={nt} members={members} viewer={viewer} />
                </div>
              </article>
            ))}
            {!notices.length && <p className="notice-empty">Nothing yet.</p>}
          </div>
        </div>
        <div className="sheet-actions">
          <button type="button" className="chip-button" onClick={onCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}

/// Who has actually seen this. Filled circle = seen it, faded = has not.
function ReadBy({ notice, members, viewer }) {
  const seen = new Set((notice.reads || []).map((r) => r.memberId));
  const all = members.length > 0 && members.every((m) => seen.has(m.id));
  return (
    <span className="notice-reads" title={all ? "Everyone has seen this" : "Still to see it: " + members.filter((m) => !seen.has(m.id)).map((m) => m.name).join(", ")}>
      {members.map((m) => (
        <span
          key={m.id}
          className={`notice-read ${personColour(m)} ${seen.has(m.id) ? "seen" : ""} ${m.id === viewer?.id ? "is-you" : ""}`}
        >
          {m.initials}
        </span>
      ))}
      <em>{all ? "all seen" : `${seen.size}/${members.length}`}</em>
    </span>
  );
}

const personColour = (m) => {
  const k = String(m?.colorKey || m?.name || "").toLowerCase();
  return ["rhian", "danielle", "lachie", "jack", "maddie"].includes(k) ? `person-${k}` : "person-family";
};

function NoticeComposer({ onCancel, onSend }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return setError("Say something first.");
    setBusy(true); setError("");
    // First line is the headline, the rest is detail.
    const [first, ...rest] = t.split("\n");
    try { await onSend(first.trim(), rest.join("\n").trim() || null); onCancel(); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="notification-sheet" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <p className="eyebrow">NOTIFY FAMILY</p>
        <h2>Tell everyone</h2>
        <textarea
          rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Dinner is at the Hales' tonight, straight after basketball"
        />
        {error && <div className="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="chip-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="calendar-add-item" disabled={busy}>{busy ? "Sending…" : "Send to family"}</button>
        </div>
      </form>
    </div>
  );
}

function Today({ viewing, members, upcoming, openTasks, chores, toggleTask, toggleChore, onSeeAll }) {
  const openChores = chores.filter((c) => !c.completed);
  return (
    <>
      <section className="today-hero">
        <div>
          <p className="eyebrow" style={{ color: "#f0c987" }}>YOUR DAY</p>
          <h2>{greeting()}{viewing ? `, ${viewing.name}` : ""}</h2>
          <p>
            {openTasks.length
              ? `${openTasks.length} thing${openTasks.length === 1 ? "" : "s"} to move forward today.`
              : "Everything is clear for today."}
          </p>
        </div>
        <button onClick={onSeeAll}>Full calendar →</button>
      </section>

      {openChores.length > 0 && (
        <section className="today-reminders">
          <p className="eyebrow">ROUTINES</p>
          <h2>Still to do around the house</h2>
          {openChores.slice(0, 5).map((c) => (
            <article key={c.id}>
              <span style={{ fontSize: 20 }}>🔁</span>
              <div>
                <strong>{c.title}</strong>
                <small>{[c.member?.name, c.cadence].filter(Boolean).join(" · ") || "Anyone"}</small>
              </div>
              <button onClick={() => toggleChore(c)}>Done</button>
            </article>
          ))}
        </section>
      )}

      <div className="today-grid">
        <section className="agenda-card">
          <div className="section-title">
            <h2>Coming up</h2>
            <button onClick={onSeeAll}>Full calendar →</button>
          </div>
          <div className="timeline">
            {upcoming.slice(0, 6).map((e) => (
              <article key={e.id}>
                <time>{timeOf(e.startsAt)}</time>
                <span className={`timeline-dot ${personClass(e.member, members)}`}
                      style={{ color: "var(--member-color, var(--navy))" }} />
                <div>
                  <strong>{e.title}</strong>
                  <small>{[dayOf(e.startsAt), e.location, e.member?.name].filter(Boolean).join(" · ")}</small>
                </div>
              </article>
            ))}
            {!upcoming.length && <p style={{ color: "var(--muted)" }}>Nothing scheduled.</p>}
          </div>
        </section>

        <section className="task-card">
          <div className="section-title"><h2>To do</h2><span className="count-badge">{openTasks.length}</span></div>
          <div className="today-task-list">
            {openTasks.slice(0, 8).map((t) => (
              <button key={t.id} onClick={() => toggleTask(t)}>
                <span className="task-check" />
                <div>
                  <strong>{t.title}</strong>
                  <small>{[t.member?.name || "Unallocated", t.dueAt && dayOf(t.dueAt)].filter(Boolean).join(" · ")}</small>
                </div>
                <span style={{ color: "#c3c7d0" }}>›</span>
              </button>
            ))}
            {!openTasks.length && <p style={{ color: "var(--muted)" }}>Everything is done for today.</p>}
          </div>
        </section>
      </div>
    </>
  );
}

function Tasks({ open, done, members, toggle }) {
  return (
    <div className="today-grid">
      <section className="task-card">
        <div className="section-title"><h2>Open</h2><span className="count-badge">{open.length}</span></div>
        <div className="today-task-list">
          {open.map((t) => (
            <button key={t.id} onClick={() => toggle(t)}>
              <span className="task-check" />
              <div>
                <strong>{t.title}</strong>
                <small>{[t.member?.name || "Unallocated", t.list?.name].filter(Boolean).join(" · ")}</small>
              </div>
              <span style={{ color: "#c3c7d0" }}>›</span>
            </button>
          ))}
          {!open.length && <p style={{ color: "var(--muted)" }}>Nothing outstanding.</p>}
        </div>
      </section>
      <section className="task-card">
        <div className="section-title"><h2>Recently done</h2><span className="count-badge">{done.length}</span></div>
        <div className="today-task-list">
          {done.slice(0, 12).map((t) => (
            <button key={t.id} onClick={() => toggle(t)}>
              <span className="task-check" style={{ background: "#7fbf8a", borderColor: "#7fbf8a" }}>✓</span>
              <div>
                <strong style={{ color: "#98a0ad", textDecoration: "line-through" }}>{t.title}</strong>
                <small>{t.member?.name || "Unallocated"}</small>
              </div>
              <span />
            </button>
          ))}
          {!done.length && <p style={{ color: "var(--muted)" }}>Nothing completed yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Family({ members, tasks }) {
  return (
    <div className="today-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
      {members.map((m) => {
        const mine = tasks.filter((t) => t.memberId === m.id && t.status === "OPEN").length;
        return (
          <section className="task-card" key={m.id}>
            <div className={`section-title ${personClass(m, members)}`}>
              <h2>{m.name}</h2>
              <span className="count-badge">{m.initials}</span>
            </div>
            <p style={{ color: "var(--muted)", margin: "10px 0 0", fontSize: 15 }}>{m.role || "Family"}</p>
            <p style={{ marginTop: 14, fontWeight: 800 }}>
              {mine} open task{mine === 1 ? "" : "s"}
            </p>
          </section>
        );
      })}
    </div>
  );
}

function Recipes({ meals }) {
  return (
    <section className="agenda-card">
      <div className="section-title"><h2>Meals &amp; recipes</h2><span className="count-badge">{meals.length}</span></div>
      <div className="today-task-list">
        {meals.map((m) => (
          <div key={m.id} style={{ padding: "11px 0", borderTop: "1px solid #eef1f6" }}>
            <strong style={{ fontSize: 15 }}>{m.name}</strong>
            <small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>
              {m.notes || (m.plannedFor ? dayOf(m.plannedFor) : "Not scheduled")}
            </small>
          </div>
        ))}
        {!meals.length && <p style={{ color: "var(--muted)" }}>No meals added yet.</p>}
      </div>
    </section>
  );
}

function Shopping({ items, toggle }) {
  const left = items.filter((i) => !i.checked);
  return (
    <section className="task-card" style={{ maxWidth: 720 }}>
      <div className="section-title"><h2>Shopping list</h2><span className="count-badge">{left.length}</span></div>
      <div className="today-task-list">
        {items.map((i) => (
          <button key={i.id} onClick={() => toggle(i)}>
            <span className="task-check" style={i.checked ? { background: "#7fbf8a", borderColor: "#7fbf8a" } : undefined}>
              {i.checked ? "✓" : ""}
            </span>
            <div>
              <strong style={i.checked ? { color: "#98a0ad", textDecoration: "line-through" } : undefined}>
                {i.name}{i.quantity ? ` · ${i.quantity}` : ""}
              </strong>
              <small>{i.store || "Any store"}</small>
            </div>
            <span />
          </button>
        ))}
        {!items.length && <p style={{ color: "var(--muted)" }}>The list is empty.</p>}
      </div>
    </section>
  );
}

function Placeholder({ item }) {
  return (
    <div className="module-placeholder">
      <span>{item.emoji}</span>
      <h2>{item.label}</h2>
      <p>{PLACEHOLDER[item.key]}</p>
      <p style={{ marginTop: 14, fontSize: 14, color: "#98a0ad" }}>Not built yet.</p>
    </div>
  );
}

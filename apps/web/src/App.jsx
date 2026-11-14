import React, { useEffect, useMemo, useState } from "react";
import Calendar from "./Calendar.jsx";
import Jade from "./Jade.jsx";
import { canSpeak, primeSpeech, speak } from "./voice.js";
import Reminders from "./Reminders.jsx";
import TaskCard from "./TaskCard.jsx";
import TasksBoard, { TaskSheet, bucket, whenOf } from "./Tasks.jsx";
import Ideas from "./Ideas.jsx";
import RecipeBook from "./RecipeBook.jsx";
import ShoppingList from "./Shopping.jsx";
import { TonightCard } from "./MealPlan.jsx";
import { usePhone, PhoneDay, NoticeLine, PhoneTiles, JadeBar, WhoSheet, ThisPhone, ScopeToggle, JadeOrb } from "./PhoneHome.jsx";

/* Nav mirrors Rhian's prototype. `ready` marks modules the API can serve today;
   the rest render an honest placeholder rather than fake data. */
const NAV = [
  { key: "today",       emoji: "🏠",        label: "Home",        ready: true, today: true, primary: true },
  { key: "calendar",    emoji: "🗓️",        label: "Calendar",    ready: true, primary: true },
  { key: "tasks",       emoji: "✅",        label: "Tasks",       ready: true, primary: true },
  { key: "ideas",       emoji: "💡",        label: "Ideas",       ready: true },
  { key: "recipes",     emoji: "🍲",        label: "Recipes",     ready: true },
  { key: "shopping",    emoji: "🛒",        label: "Shopping",    ready: true, primary: true },
  { key: "inputs",      emoji: "📥",        label: "Inputs",      parentOnly: true },
  { key: "finances",    emoji: "💰",        label: "Finances",    parentOnly: true },
  { key: "investments", emoji: "📈",        label: "Investments", parentOnly: true },
  { key: "how",         emoji: "?",         label: "How do I" },
  { key: "uploads",     emoji: "＋",        label: "Uploads" }
];

/* Not in NAV: Settings is reached from the cog, not the rail. It is where
   things are configured rather than looked at - the family themselves, and
   in time the bank and investment sources that feed Inputs and Finances. */
const SETTINGS = { key: "settings", emoji: "⚙", label: "Settings" };

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
  const [jadeOpen, setJadeOpen]     = useState(false);
  const [jadeAbout, setJadeAbout]   = useState(null);    // the task Jade was opened about
  const [jadeIdea, setJadeIdea]     = useState(null);    // { mode: "new" } or { id, title }
  const [ideasVersion, setIdeasVersion] = useState(0);   // bumped so the board re-reads after Jade saves
  const [focusTaskId, setFocusTaskId] = useState(null);  // the task a reminder opened
  const [editingTask, setEditingTask] = useState(null);  // null = closed, {} = new, a task = editing
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const phone = usePhone();
  const [askWho, setAskWho] = useState(() => !recallViewer());   // a phone asks once whose it is
  const setThisPhone = (m) => { setViewingId(String(m.id)); rememberViewer(m.id); setScope("mine"); setAskWho(false); };

  const load = async () => { setData(await api("/api/dashboard")); setIdeasVersion((v) => v + 1); };

  /* A reminder opens the app on its item: /?task=9 or /?event=8. Read once,
     then the address is cleaned so a reload does not reopen it. If the app
     is already open, the service worker sends the same link as a message
     instead. */
  useEffect(() => {
    const openFrom = (href) => {
      try {
        const q = new URL(href, window.location.origin).searchParams;
        if (q.get("task")) setFocusTaskId(Number(q.get("task")));
        else if (q.get("event")) setTab("calendar");
      } catch { /* not a link we understand */ }
    };
    openFrom(window.location.href);
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    const onMessage = (e) => { if (e.data?.type === "open-item") openFrom(e.data.url); };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    api("/api/session")
      .then((s) => { setSession(s.authenticated); if (s.authenticated) return load(); })
      .catch(() => setSession(false));
  }, []);

  /* Other devices change things too - a child ticks something off on a
     phone, and the parent's laptop should show it without a refresh. So the
     app re-reads whenever it comes back into view, and once a minute while
     it is on screen. A hidden tab does nothing. */
  useEffect(() => {
    if (!session) return undefined;
    const refresh = () => { if (document.visibilityState === "visible") load().catch(() => {}); };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [session]);

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
  const current  = tab === SETTINGS.key ? SETTINGS : (nav.find((n) => n.key === tab) || nav[0]);
  const parents  = data.members.filter((m) => m.role === "PARENT").slice(0, 2);

  return (
    <div className={`app-shell${phone ? " phone-shell" : ""}${phone && tab === "today" ? " on-home" : ""}`}>
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
        {!phone && (<>
        <header className="topbar">
          <div>
            <p className="eyebrow">FAMILY COMMAND CENTRE</p>
            <h1>{current.label}</h1>
          </div>
          <div className="topbar-actions">
            <div className="profile-picker">
              <span>Viewing as</span>
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
            <button
              className={`round-button settings-button ${tab === SETTINGS.key ? "active" : ""}`}
              onClick={() => setTab(tab === SETTINGS.key ? "today" : SETTINGS.key)}
              title="Settings"
            >⚙</button>
            {/* primeSpeech must run inside this tap: Safari will not speak later
                unless the engine was woken by a real gesture, and Jade now
                starts listening as soon as the sheet opens. */}
            <button
              className="voice-button"
              onClick={() => { primeSpeech(); setJadeOpen(true); }}
              title="Talk to Jade"
            >
              <span className="voice-mark"><i /><i /><i /><i /></span>
              Talk to Jade
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
        </>)}

        <div className="page-body">
          {message && <div className="alert" style={{ marginBottom: 18 }}>{message}</div>}

          {tab === "today" && phone && (
            <div className="phone-home">
              <PhoneDay viewer={viewer} isParent={isParent} scope={scope} setScope={setScope}
                todayCount={openTasks.filter((t) => ["overdue", "today"].includes(bucket(t, new Date()))).length} />
              {unread.length
                ? <Notices unread={unread} members={data.members} viewer={viewer}
                    onCompose={() => setComposing(true)} onRead={markNoticesRead} onHistory={openHistory} />
                : <NoticeLine onHistory={openHistory} onCompose={() => setComposing(true)} />}
              <PhoneTiles api={api} version={ideasVersion} openTasks={openTasks} chores={myChores} upcoming={upcoming} go={setTab} />
              <JadeOrb onTalk={() => { primeSpeech(); setJadeOpen(true); }} />
            </div>
          )}

          {tab === "today" && !phone && (
            <Notices
              unread={unread} members={data.members} viewer={viewer}
              onCompose={() => setComposing(true)} onRead={markNoticesRead} onHistory={openHistory}
            />
          )}

          {tab === "today" && !phone && (
            <Today
              viewing={viewer} members={data.members} upcoming={upcoming}
              openTasks={openTasks} chores={myChores}
              toggleTask={toggleTask} toggleChore={toggleChore} onSeeAll={() => setTab("calendar")}
              onSeeTasks={() => setTab("tasks")}
              onOpenTask={(t) => setFocusTaskId(t.id)}
              dinner={<TonightCard api={api} version={ideasVersion} onPlan={() => setTab("recipes")} />}
            />
          )}
          {tab === "calendar" && (
            <Calendar
              events={scopedEvents} tasks={scheduled} members={data.members} calendars={data.calendars || []}
              viewer={viewer} onCreate={createEvent} onUpdate={updateEvent} onDelete={deleteEvent}
              onToggleTask={(t) => (t.kind && t.kind !== "TASK") ? toggleChore(t) : toggleTask(t)}
              onOpenTask={(t) => setFocusTaskId(t.id)}
              onSchedule={scheduleTask}
              headerExtra={phone && isParent ? <ScopeToggle scope={scope} setScope={setScope} /> : null}
            />
          )}
          {tab === "tasks"    && (
            <TasksBoard
              tasks={data.tasks || []} members={data.members} viewer={viewer} everyone={everyone}
              onOpen={(t) => setFocusTaskId(t.id)} onToggle={toggleTask} onAdd={() => setEditingTask({})}
              scopeToggle={phone && isParent ? <ScopeToggle scope={scope} setScope={setScope} /> : null}
            />
          )}
          {tab === "settings" && (
          <Settings
            members={data.members} tasks={data.tasks} viewer={viewer} onSetViewer={setThisPhone}
            onSaveSound={async (id, pronunciation) => {
              await api(`/api/members/${id}`, {
                method: "PATCH", body: JSON.stringify({ pronunciation })
              });
              await load();
            }}
          />
        )}
          {tab === "ideas" && (
            <Ideas
              api={api} viewer={viewer} members={data.members} version={ideasVersion}
              onTalk={(idea) => { primeSpeech(); setJadeAbout(null); setJadeIdea(idea); setJadeOpen(true); }}
            />
          )}
          {tab === "recipes"  && <RecipeBook api={api} viewer={viewer} members={data.members} onShopping={load} />}
          {tab === "shopping" && <ShoppingList api={api} items={data.shopping} viewer={viewer} onChange={load} />}
          {!current.ready && <Placeholder item={current} />}
        </div>
      </div>

      {phone && tab !== "today" && !jadeOpen && <JadeBar onTalk={() => { primeSpeech(); setJadeOpen(true); }} />}
      {phone && askWho && data?.members?.length > 0 && <WhoSheet members={data.members} onPick={setThisPhone} />}
      {moreOpen && (
        <MoreSheet
          items={nav.filter((i) => !i.primary)} current={tab}
          onPick={(k) => { setTab(k); setMoreOpen(false); }}
          onCancel={() => setMoreOpen(false)}
          onSignOut={logout}
          onReminders={() => { setTab("settings"); setMoreOpen(false); }}
        />
      )}
      {jadeOpen && (
        <Jade
          viewer={viewer}
          members={data.members}
          about={jadeAbout}
          idea={jadeIdea}
          onClose={() => { setJadeOpen(false); setJadeAbout(null); setJadeIdea(null); }}
          onChanged={load}
        />
      )}
      {focusTaskId && data && (
        <TaskCard
          task={(data.tasks || []).find((t) => t.id === focusTaskId) || null}
          onClose={() => setFocusTaskId(null)}
          onDone={async (t) => {
            await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "DONE", actorId: viewer?.id }) });
            await load();
          }}
          onEdit={(t) => { setFocusTaskId(null); setEditingTask(t); }}
          onReopen={async (t) => {
            await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: "OPEN", actorId: viewer?.id }) });
            await load();
          }}
          onTalk={(t) => { primeSpeech(); setFocusTaskId(null); setJadeAbout(t); setJadeOpen(true); }}
        />
      )}
      {editingTask && data && (
        <TaskSheet
          task={editingTask.id ? editingTask : null}
          members={data.members} viewer={viewer}
          onCancel={() => setEditingTask(null)}
          onSave={async (id, payload) => {
            await api(id ? `/api/tasks/${id}` : "/api/tasks", {
              method: id ? "PATCH" : "POST",
              body: JSON.stringify({ ...payload, actorId: viewer?.id })
            });
            await load();
          }}
          onDelete={async (id) => {
            await api(`/api/tasks/${id}`, { method: "DELETE", body: JSON.stringify({ actorId: viewer?.id }) });
            await load();
          }}
        />
      )}
      {composing && <NoticeComposer onCancel={() => setComposing(false)} onSend={postNotice} />}
      {history !== null && <HistorySheet notices={history} members={data.members} viewer={viewer} onCancel={() => setHistory(null)} />}
    </div>
  );
}

function MoreSheet({ items, current, onPick, onCancel, onSignOut, onReminders }) {
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
          {onReminders && (
            <button type="button" className="chip-button" onClick={onReminders}>⚙ Settings &amp; reminders</button>
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

function Today({ viewing, members, upcoming, openTasks, chores, toggleTask, toggleChore, onSeeAll, onOpenTask, onSeeTasks, dinner }) {
  const openChores = chores.filter((c) => !c.completed);
  /* Home shows only what needs attention now: overdue first, then today.
     Everything else lives on the Tasks screen. */
  const now = new Date();
  const urgent = openTasks
    .filter((t) => ["overdue", "today"].includes(bucket(t, now)))
    .sort((a, b) => new Date(whenOf(a)) - new Date(whenOf(b)));
  const overdue = urgent.filter((t) => bucket(t, now) === "overdue").length;
  const later = openTasks.length - urgent.length;
  return (
    <>
      <section className="today-hero">
        <div>
          <p className="eyebrow" style={{ color: "#f0c987" }}>YOUR DAY</p>
          <h2>{greeting()}{viewing ? `, ${viewing.name}` : ""}</h2>
          <p>
            {urgent.length
              ? `${urgent.length} thing${urgent.length === 1 ? "" : "s"} to move forward today` +
                (overdue ? `, ${overdue} overdue.` : ".")
              : "Everything is clear for today."}
          </p>
        </div>
        <button onClick={onSeeAll}>Full calendar →</button>
      </section>

      {dinner}

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
          <div className="section-title">
            <h2>To do today</h2>
            <button onClick={onSeeTasks}>All tasks →</button>
          </div>
          <div className="today-task-list">
            {urgent.slice(0, 8).map((t) => (
              /* The row opens the task; only the circle ticks it off. */
              <button key={t.id} onClick={() => onOpenTask(t)}>
                <span className="task-check" title="Tick off"
                      onClick={(ev) => { ev.stopPropagation(); toggleTask(t); }} />
                <div>
                  <strong>{t.title}{t.needsHelp && <span title="Asked for help" style={{ marginLeft: 6 }}>🙋</span>}</strong>
                  <small style={bucket(t, now) === "overdue" ? { color: "var(--coral)", fontWeight: 800 } : undefined}>
                    {[bucket(t, now) === "overdue" ? "Overdue" : null, t.member?.name || "Unallocated",
                      whenOf(t) && `${dayOf(whenOf(t))} ${timeOf(whenOf(t))}`].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <span style={{ color: "#c3c7d0" }}>›</span>
              </button>
            ))}
            {!urgent.length && <p style={{ color: "var(--muted)" }}>Nothing due today.</p>}
            {later > 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13, margin: "8px 0 0" }}>
                {later} more coming up later — <button onClick={onSeeTasks}
                  style={{ border: 0, background: "none", padding: 0, color: "var(--navy)", fontWeight: 800, cursor: "pointer" }}>see all tasks</button>
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Tasks({ open, done, members, toggle, onOpen }) {
  return (
    <div className="today-grid">
      <section className="task-card">
        <div className="section-title"><h2>Open</h2><span className="count-badge">{open.length}</span></div>
        <div className="today-task-list">
          {open.map((t) => (
            /* The row opens the task; only the circle ticks it off. */
            <button key={t.id} onClick={() => onOpen(t)}>
              <span className="task-check" title="Tick off"
                    onClick={(ev) => { ev.stopPropagation(); toggle(t); }} />
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
            <button key={t.id} onClick={() => onOpen(t)}>
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

/* Everything that is set up rather than looked at. Desktop only, deliberately:
   configuring a household is a sit-down job, and squeezing it onto a phone
   would mean doing it badly in both places. The cog is already hidden below
   700px; this is the other half of that promise. */
function Settings({ members, tasks, viewer, onSaveSound, onSetViewer }) {
  const [phone, setPhone] = useState(() => {
    try { return window.matchMedia("(max-width: 700px)").matches; } catch { return false; }
  });
  const [jade, setJade] = useState(null);

  useEffect(() => {
    try {
      const mq = window.matchMedia("(max-width: 700px)");
      const on = (e) => setPhone(e.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch { return undefined; }
  }, []);

  useEffect(() => {
    let alive = true;
    api("/api/jade/status").then((s) => alive && setJade(s)).catch(() => alive && setJade({ connected: false }));
    return () => { alive = false; };
  }, []);

  if (phone) {
        return (
      <>
        <section className="agenda-card">
          <div className="section-title"><h2>Settings</h2></div>
          <p className="empty-capture" style={{ marginTop: 12 }}>
            Setting the family up is a desktop job — there is too much of it for a
            phone screen. Open the Family Command Centre on a computer.
          </p>
        </section>
        <ThisPhone members={members} viewer={viewer} onChange={onSetViewer} />
        <Reminders api={api} members={members} viewer={viewer} />
      </>
    );
  }

  return (
    <div className="settings-page">
      <section className="agenda-card">
        <div className="section-title">
          <h2>The family</h2>
          <span className="count-badge">{members.length}</span>
        </div>
        <p className="connections-intro" style={{ margin: "4px 0 16px", textAlign: "left", maxWidth: "none" }}>
          Who is in the household, and how each name is said when Jade speaks.
        </p>
        <Family members={members} tasks={tasks} onSaveSound={onSaveSound} />
      </section>

      <Reminders api={api} members={members} viewer={viewer} showAll />

      <section className="agenda-card">
        <div className="section-title"><h2>Connections</h2></div>
        <div className="connection-list" style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <ConnectionRow
            icon="✦" name="Jade"
            detail={jade?.connected ? `Answering on ${jade.model}` : "No API key set on the server"}
            state={jade === null ? "pending" : jade.connected ? "connected" : "off"}
          />
          <ConnectionRow
            icon="M" name="Microsoft 365"
            detail="Outlook calendar and To Do. Not built yet — it arrives with per-person sign-in."
            state="off"
          />
        </div>
        <div className="connection-note">
          <strong>Everyone still shares one password.</strong>
          <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Individual sign-in comes with the Microsoft connection, and replaces it.
          </p>
        </div>
      </section>
    </div>
  );
}

function ConnectionRow({ icon, name, detail, state }) {
  const label = state === "connected" ? "Connected" : state === "pending" ? "Checking…" : "Not connected";
  return (
    <div className="connection-row">
      <span className="connection-icon">{icon}</span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <span className={`connection-state ${state}`}>{label}</span>
    </div>
  );
}

function Family({ members, tasks, onSaveSound }) {
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
            <SaysName member={m} onSave={onSaveSound} />
          </section>
        );
      })}
    </div>
  );
}

/* Spelling a name the way it sounds is the only way to make an English
   speech engine say it right - Rhian is "Ryan", Danielle is "Dan-eel". It
   is used when Jade speaks and nowhere else; the screen always shows the
   real name. */
function SaysName({ member, onSave }) {
  const [value, setValue] = useState(member.pronunciation || "");
  const [state, setState] = useState("");

  useEffect(() => { setValue(member.pronunciation || ""); }, [member.pronunciation]);

  const save = async () => {
    if ((member.pronunciation || "") === value.trim()) return;
    setState("saving");
    try { await onSave(member.id, value.trim()); setState("saved"); setTimeout(() => setState(""), 1800); }
    catch { setState("failed"); }
  };

  /* You cannot tune a phonetic spelling you cannot hear. This says the box's
     current contents through the same engine Jade uses, so the thing being
     judged is the thing that will be said. */
  const hear = () => {
    primeSpeech();
    speak(value.trim() || member.name);
  };

  return (
    <label className="says-name">
      <span>Said aloud as</span>
      <div className="says-name-row">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder={member.name}
          aria-label={`How ${member.name} is said aloud`}
        />
        {canSpeak && (
          <button type="button" className="chip-button" onClick={hear} title={`Hear ${member.name}`}>
            Hear it
          </button>
        )}
      </div>
      <small>
        {state === "saving" ? "Saving…"
          : state === "saved" ? "Saved"
          : state === "failed" ? "Didn't save"
          : "Only used when Jade speaks"}
      </small>
    </label>
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

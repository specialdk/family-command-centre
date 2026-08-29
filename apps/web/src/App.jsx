import React, { useEffect, useMemo, useState } from "react";

/* Nav mirrors Rhian's prototype. `ready` marks modules the API can serve today;
   the rest render an honest placeholder rather than fake data. */
const NAV = [
  { key: "today",       emoji: "🏠",        label: "Today",       ready: true, today: true },
  { key: "calendar",    emoji: "🗓️",        label: "Calendar",    ready: true },
  { key: "tasks",       emoji: "✅",        label: "Tasks",       ready: true },
  { key: "family",      emoji: "👨‍👩‍👧‍👦", label: "Family",      ready: true },
  { key: "recipes",     emoji: "🍲",        label: "Recipes",     ready: true },
  { key: "ideas",       emoji: "💡",        label: "Ideas" },
  { key: "inputs",      emoji: "📥",        label: "Inputs" },
  { key: "finances",    emoji: "💰",        label: "Finances" },
  { key: "investments", emoji: "📈",        label: "Investments" },
  { key: "shopping",    emoji: "🛒",        label: "Shopping",    ready: true },
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
  const [viewingId, setViewingId] = useState("");
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
  const toggleShopping = (i) => mutate(() => api(`/api/shopping/${i.id}`, {
    method: "PATCH", body: JSON.stringify({ checked: !i.checked })
  }));

  const openTasks = useMemo(() => data?.tasks?.filter((t) => t.status === "OPEN") || [], [data]);
  const doneTasks = useMemo(() => data?.tasks?.filter((t) => t.status === "DONE") || [], [data]);
  const upcoming  = useMemo(() =>
    (data?.events || []).filter((e) => new Date(e.endsAt) >= new Date())
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)), [data]);

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

  const current  = NAV.find((n) => n.key === tab) || NAV[0];
  const viewing  = data.members.find((m) => String(m.id) === String(viewingId)) || data.members[0];
  const parents  = data.members.filter((m) => m.role === "Parent").slice(0, 2);

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <div className="brand-mark"><span style={{ fontSize: 26 }}>🏡</span></div>
        <nav>
          <div className="sortable-nav">
            {NAV.map((item) => (
              <button
                key={item.key}
                className={[item.today ? "today-nav" : "", tab === item.key ? "active" : ""].filter(Boolean).join(" ")}
                onClick={() => setTab(item.key)}
                title={item.label}
              >
                {item.today && <em>HOME</em>}
                <span>{item.emoji}</span>
                <small>{item.label}</small>
                {!item.today && <i className="nav-grip">⋮⋮</i>}
              </button>
            ))}
          </div>
        </nav>
        <button className="avatar-button" onClick={logout} title="Sign out">
          {viewing?.initials || "—"}
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
              <select value={viewingId} onChange={(e) => setViewingId(e.target.value)}>
                {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
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
          <span className="status-meta">Family view · {saving ? "Saving…" : "Saved"}</span>
        </div>

        <div className="page-body">
          {message && <div className="alert" style={{ marginBottom: 18 }}>{message}</div>}

          {tab === "today" && (
            <Today
              viewing={viewing} members={data.members} upcoming={upcoming}
              openTasks={openTasks} chores={data.chores}
              toggleTask={toggleTask} toggleChore={toggleChore} onSeeAll={() => setTab("calendar")}
            />
          )}
          {tab === "calendar" && <Calendar events={upcoming} members={data.members} />}
          {tab === "tasks"    && <Tasks open={openTasks} done={doneTasks} members={data.members} toggle={toggleTask} />}
          {tab === "family"   && <Family members={data.members} tasks={data.tasks} />}
          {tab === "recipes"  && <Recipes meals={data.meals} />}
          {tab === "shopping" && <Shopping items={data.shopping} toggle={toggleShopping} />}
          {!current.ready && <Placeholder item={current} />}
        </div>
      </div>
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

function Calendar({ events, members }) {
  return (
    <section className="agenda-card">
      <div className="section-title"><h2>Family calendar</h2><span className="count-badge">{events.length}</span></div>
      <div className="timeline">
        {events.map((e) => (
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
        {!events.length && <p style={{ color: "var(--muted)" }}>No events yet.</p>}
      </div>
    </section>
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
                <small>{[t.member?.name || "Unallocated", t.list].filter(Boolean).join(" · ")}</small>
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

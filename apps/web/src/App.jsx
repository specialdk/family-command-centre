import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays, CheckCircle2, Circle, Home, LogOut, Menu, Mic, Plus,
  ShoppingCart, Soup, Users, WandSparkles, Repeat2, Printer
} from "lucide-react";

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
};

const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value))
  : "No due date";

export default function App() {
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState("");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("today");
  const [message, setMessage] = useState("");
  const [capture, setCapture] = useState("");
  const [memberId, setMemberId] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = async () => {
    const result = await api("/api/dashboard");
    setData(result);
  };

  useEffect(() => {
    api("/api/session")
      .then(s => {
        setSession(s.authenticated);
        if (s.authenticated) return load();
      })
      .catch(() => setSession(false));
  }, []);

  const login = async (e) => {
    e.preventDefault();
    setMessage("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      setSession(true);
      setPassword("");
      await load();
    } catch (e) { setMessage(e.message); }
  };

  const logout = async () => {
    await api("/api/logout", { method: "POST" });
    setSession(false);
    setData(null);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!capture.trim()) return;
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: capture.trim(),
        list: "HOME",
        memberId: memberId || null
      })
    });
    setCapture("");
    setMemberId("");
    await load();
  };

  const toggleTask = async (task) => {
    await api(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: task.status === "DONE" ? "OPEN" : "DONE" })
    });
    await load();
  };

  const assignTask = async (task, value) => {
    await api(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ memberId: value || null })
    });
    await load();
  };

  const toggleChore = async (chore) => {
    await api(`/api/chores/${chore.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: !chore.completed })
    });
    await load();
  };

  const toggleShopping = async (item) => {
    await api(`/api/shopping/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ checked: !item.checked })
    });
    await load();
  };

  const startVoice = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setMessage("Speech recognition is not available in this browser. Type into Quick Capture instead.");
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-AU";
    rec.interimResults = false;
    rec.onresult = (event) => setCapture(event.results[0][0].transcript);
    rec.onerror = () => setMessage("Voice capture could not be completed.");
    rec.start();
  };

  const openTasks = useMemo(() => data?.tasks?.filter(t => t.status === "OPEN") || [], [data]);
  const doneTasks = useMemo(() => data?.tasks?.filter(t => t.status === "DONE") || [], [data]);

  if (session === null) return <div className="splash">Opening Family Command Centre…</div>;

  if (!session) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={login}>
          <div className="logo">F</div>
          <h1>Family Command Centre</h1>
          <p>Private family access</p>
          <label>
            Family password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
          </label>
          <button className="primary" type="submit">Open dashboard</button>
          {message && <div className="alert">{message}</div>}
        </form>
      </main>
    );
  }

  if (!data) return <div className="splash">Loading family dashboard…</div>;

  const nav = [
    ["today", Home, "Today"],
    ["calendar", CalendarDays, "Calendar"],
    ["tasks", CheckCircle2, "Tasks"],
    ["chores", Repeat2, "Chores"],
    ["meals", Soup, "Meals"],
    ["shopping", ShoppingCart, "Shopping"],
    ["family", Users, "Family"]
  ];

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand"><div className="logo small">F</div><div><strong>Family</strong><span>Command Centre</span></div></div>
        <nav>
          {nav.map(([key, Icon, label]) => (
            <button key={key} className={tab === key ? "nav active" : "nav"} onClick={() => { setTab(key); setMenuOpen(false); }}>
              <Icon size={19} /> {label}
            </button>
          ))}
        </nav>
        <button className="nav bottom" onClick={logout}><LogOut size={18}/> Sign out</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <button className="icon mobile-menu" onClick={() => setMenuOpen(v => !v)} aria-label="Menu"><Menu /></button>
          <div>
            <p className="eyebrow">Family Command Centre</p>
            <h1>{nav.find(n => n[0] === tab)?.[2] || "Today"}</h1>
          </div>
          <button className="icon" onClick={() => window.print()} title="Print"><Printer size={20}/></button>
        </header>

        {message && <div className="alert inline">{message}<button onClick={() => setMessage("")}>×</button></div>}

        <section className="quick-card no-print">
          <div className="quick-title"><WandSparkles size={18}/><strong>Quick Capture</strong><span>Type or speak anything the family needs to remember.</span></div>
          <form className="capture-row" onSubmit={addTask}>
            <input value={capture} onChange={e => setCapture(e.target.value)} placeholder="e.g. Lachie needs sports uniform Thursday" />
            <select value={memberId} onChange={e => setMemberId(e.target.value)} aria-label="Assign to">
              <option value="">Unallocated</option>
              {data.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" className="icon voice" onClick={startVoice} title="Voice capture"><Mic size={19}/></button>
            <button className="primary add" type="submit"><Plus size={18}/> Add</button>
          </form>
        </section>

        {tab === "today" && <Today data={data} openTasks={openTasks} toggleTask={toggleTask} toggleChore={toggleChore}/>}
        {tab === "calendar" && <CalendarView events={data.events}/>}
        {tab === "tasks" && <TaskView open={openTasks} done={doneTasks} members={data.members} toggle={toggleTask} assign={assignTask}/>}
        {tab === "chores" && <ChoreView chores={data.chores} toggle={toggleChore}/>}
        {tab === "meals" && <MealView meals={data.meals}/>}
        {tab === "shopping" && <ShoppingView items={data.shopping} toggle={toggleShopping}/>}
        {tab === "family" && <FamilyView members={data.members} tasks={data.tasks}/>}
      </main>
    </div>
  );
}

function Today({ data, openTasks, toggleTask, toggleChore }) {
  const upcoming = data.events.filter(e => new Date(e.endsAt) >= new Date()).slice(0, 4);
  return (
    <>
      <div className="stats">
        <Stat label="Open tasks" value={openTasks.length}/>
        <Stat label="Upcoming events" value={upcoming.length}/>
        <Stat label="Chores remaining" value={data.chores.filter(c => !c.completed).length}/>
        <Stat label="Shopping items" value={data.shopping.filter(i => !i.checked).length}/>
      </div>
      <div className="grid two">
        <Card title="What needs doing">
          {openTasks.slice(0,6).map(t => <CheckRow key={t.id} checked={false} onClick={() => toggleTask(t)} title={t.title} meta={t.member?.name || "Unallocated"}/>)}
          {!openTasks.length && <Empty text="Nothing outstanding."/>}
        </Card>
        <Card title="Coming up">
          {upcoming.map(e => <div className="event-row" key={e.id}><div className="date-box">{new Date(e.startsAt).getDate()}</div><div><strong>{e.title}</strong><span>{fmtDate(e.startsAt)}{e.member ? ` · ${e.member.name}` : ""}</span></div></div>)}
          {!upcoming.length && <Empty text="No upcoming events yet."/>}
        </Card>
        <Card title="Chores">
          {data.chores.filter(c=>!c.completed).slice(0,5).map(c => <CheckRow key={c.id} checked={c.completed} onClick={() => toggleChore(c)} title={c.title} meta={[c.member?.name,c.cadence].filter(Boolean).join(" · ")}/>)}
          {!data.chores.filter(c=>!c.completed).length && <Empty text="Chores are clear."/>}
        </Card>
        <Card title="This week's meals">
          {data.meals.slice(0,5).map(m => <div className="simple-row" key={m.id}><Soup size={17}/><div><strong>{m.name}</strong><span>{m.plannedFor ? fmtDate(m.plannedFor) : "Not scheduled"}</span></div></div>)}
          {!data.meals.length && <Empty text="No meals planned yet."/>}
        </Card>
      </div>
    </>
  );
}

function CalendarView({ events }) {
  return <Card title="Family calendar">{events.map(e => <div className="event-row" key={e.id}><div className="date-box">{new Date(e.startsAt).getDate()}</div><div><strong>{e.title}</strong><span>{fmtDate(e.startsAt)} → {fmtDate(e.endsAt)}{e.location ? ` · ${e.location}` : ""}{e.member ? ` · ${e.member.name}` : ""}</span></div></div>)}{!events.length && <Empty text="No calendar events yet."/ >}</Card>;
}

function TaskView({ open, done, members, toggle, assign }) {
  return <div className="grid two">
    <Card title={`Open tasks (${open.length})`}>{open.map(t => <div className="task-edit" key={t.id}><CheckRow checked={false} onClick={()=>toggle(t)} title={t.title} meta={fmtDate(t.dueAt)}/><select value={t.memberId || ""} onChange={e=>assign(t,e.target.value)}><option value="">Unallocated</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>)}{!open.length && <Empty text="No open tasks."/>}</Card>
    <Card title={`Completed (${done.length})`}>{done.slice(0,12).map(t => <CheckRow key={t.id} checked={true} onClick={()=>toggle(t)} title={t.title} meta={t.member?.name || "Unallocated"}/>)}{!done.length && <Empty text="No completed tasks yet."/>}</Card>
  </div>;
}

function ChoreView({ chores, toggle }) { return <Card title="Chore board">{chores.map(c=><CheckRow key={c.id} checked={c.completed} onClick={()=>toggle(c)} title={c.title} meta={[c.member?.name,c.cadence].filter(Boolean).join(" · ")}/>)}{!chores.length&&<Empty text="No chores configured yet."/>}</Card>; }
function MealView({ meals }) { return <Card title="Meals & recipes">{meals.map(m=><div className="simple-row" key={m.id}><Soup size={18}/><div><strong>{m.name}</strong><span>{m.notes || (m.plannedFor ? fmtDate(m.plannedFor) : "Recipe / meal idea")}</span></div></div>)}{!meals.length&&<Empty text="No meals added yet."/>}</Card>; }
function ShoppingView({ items, toggle }) { return <Card title="Shopping list">{items.map(i=><CheckRow key={i.id} checked={i.checked} onClick={()=>toggle(i)} title={`${i.name}${i.quantity ? ` · ${i.quantity}` : ""}`} meta={i.store || "Any store"}/>)}{!items.length&&<Empty text="Shopping list is empty."/>}</Card>; }

function FamilyView({ members, tasks }) {
  return <div className="member-grid">{members.map(m=>{const mine=tasks.filter(t=>t.memberId===m.id&&t.status==="OPEN").length;return <div className="member-card" key={m.id}><div className="avatar">{m.initials}</div><strong>{m.name}</strong><span>{m.role || "Family"}</span><div className="member-count">{mine} open task{mine===1?"":"s"}</div></div>})}</div>;
}

function Stat({label,value}) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Card({title,children}) { return <section className="card"><h2>{title}</h2>{children}</section>; }
function Empty({text}) { return <div className="empty">{text}</div>; }
function CheckRow({checked,onClick,title,meta}) {
  return <button className={checked ? "check-row done" : "check-row"} onClick={onClick}>{checked?<CheckCircle2 size={20}/>:<Circle size={20}/>}<div><strong>{title}</strong>{meta&&<span>{meta}</span>}</div></button>;
}

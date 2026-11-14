import React, { useEffect, useState } from "react";
import { bucket, whenOf } from "./Tasks.jsx";
import { dayKey } from "./MealPlan.jsx";

/* The phone landing page. Simple on purpose: who and when at the top, then
   four tiles - each a count and the next thing only - that open the full
   list. Talking to Jade is the fixed button at the bottom. */

export function usePhone() {
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
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const fmt = (d, o) => new Intl.DateTimeFormat("en-AU", o).format(new Date(d));
const time = (d) => fmt(d, { hour: "numeric", minute: "2-digit" });
const sameDay = (a, b) => dayKey(new Date(a)) === dayKey(new Date(b));
const when = (d) => (sameDay(d, new Date()) ? time(d) : `${fmt(d, { weekday: "short" })} ${time(d)}`);

export function ScopeToggle({ scope, setScope, light }) {
  const btn = (key, label) => (
    <button type="button" onClick={() => setScope(key)}
      style={{ border: 0, borderRadius: 999, padding: "5px 11px", font: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer",
               background: scope === key ? (light ? "#fff" : "var(--navy)") : "transparent",
               color: scope === key ? (light ? "var(--navy)" : "#fff") : (light ? "#ffffffcc" : "var(--muted)") }}>{label}</button>
  );
  return (
    <span style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: light ? "#ffffff2e" : "#eef0f6", flex: "0 0 auto" }}>
      {btn("mine", "Me")}{btn("everyone", "All")}
    </span>
  );
}

export function PhoneDay({ viewer, isParent, scope, setScope, todayCount }) {
  return (
    <section className="today-hero" style={{ padding: "18px 18px", flexDirection: "column", alignItems: "stretch", gap: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <p className="eyebrow" style={{ color: "#f0c987", margin: 0 }}>YOUR DAY</p>
        {isParent && <ScopeToggle scope={scope} setScope={setScope} light />}
      </div>
      <h2 style={{ fontSize: 26, margin: "8px 0 4px" }}>{greeting()}{viewer ? `, ${viewer.name}` : ""}</h2>
      <p style={{ margin: 0 }}>
        {fmt(new Date(), { weekday: "long", day: "numeric", month: "short" })} · {todayCount ? `${todayCount} thing${todayCount === 1 ? "" : "s"} today` : "all clear today"}
      </p>
    </section>
  );
}

/* One slim line when there's nothing new; the full card takes over when there is. */
export function NoticeLine({ onHistory, onCompose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 4px 0", fontSize: 14 }}>
      <span style={{ color: "var(--muted)", flex: 1 }}>✓ Everyone's up to date</span>
      <button type="button" onClick={onHistory} style={{ border: 0, background: "none", color: "var(--navy)", fontWeight: 800, font: "inherit", cursor: "pointer", padding: 0 }}>Activity →</button>
      <button type="button" className="chip-button" onClick={onCompose} aria-label="Notify the family" style={{ padding: "4px 12px" }}>＋</button>
    </div>
  );
}

function Tile({ title, count, alert, line, sub, bg, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: bg ? "#fff" : "var(--ink)", minWidth: 0,
               background: bg ? `linear-gradient(to top, #000000b3 0%, #00000026 60%, #00000010 100%), center / cover no-repeat url("${bg}")` : "#fff",
               alignContent: bg ? "space-between" : "start",
               border: `1px solid ${alert ? "var(--coral)" : "var(--line)"}`, borderRadius: 18, padding: 14,
               display: "grid", gap: 8, minHeight: 122, boxShadow: "0 6px 18px #1d2a4a0d" }}>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 850, color: bg ? "#fff" : "var(--muted)", textShadow: bg ? "0 1px 3px #0008" : "none" }}>{title}</span>
        {count !== undefined && (
          <span style={{ minWidth: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center", padding: "0 7px", fontWeight: 900, fontSize: 14,
                         background: alert ? "var(--coral)" : count ? "var(--navy)" : "#eef0f6", color: alert || count ? "#fff" : "var(--muted)" }}>{count}</span>
        )}
      </span>
      <strong style={{ fontSize: 15, lineHeight: 1.3, textShadow: bg ? "0 1px 4px #000a" : "none", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{line}</strong>
      {sub && <small style={{ color: alert ? "var(--coral)" : "var(--muted)", fontWeight: alert ? 800 : 500 }}>{sub}</small>}
    </button>
  );
}

export function PhoneTiles({ api, version, openTasks, chores, upcoming, go }) {
  const [dinner, setDinner] = useState(undefined);
  useEffect(() => {
    api(`/api/plan?start=${dayKey(new Date())}`)
      .then((w) => setDinner(w.meals.find((m) => m.day === dayKey(new Date())) || null))
      .catch(() => setDinner(null));
  }, [version]);

  const now = new Date();
  const due = openTasks.filter((t) => ["overdue", "today"].includes(bucket(t, now)))
    .sort((a, b) => new Date(whenOf(a)) - new Date(whenOf(b)));
  const overdue = due.filter((t) => bucket(t, now) === "overdue").length;
  const nextTask = due[0];

  const weekOut = new Date(now.getTime() + 7 * 86400000);
  const soon = upcoming.filter((e) => new Date(e.startsAt) <= weekOut);
  const nextEvent = upcoming[0];

  const routines = chores.filter((c) => !c.completed);

  const bg = dinner?.recipe?.imageAt
    ? `/api/recipes/${dinner.recipe.id}/image?v=${encodeURIComponent(dinner.recipe.imageAt)}`
    : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <Tile title="To do today" count={due.length} alert={overdue > 0} onClick={() => go("tasks")}
        line={nextTask ? nextTask.title : "All done ✓"}
        sub={overdue ? `${overdue} overdue` : nextTask && whenOf(nextTask) ? when(whenOf(nextTask)) : null} />
      <Tile title="Coming up" count={soon.length} onClick={() => go("calendar")}
        line={nextEvent ? nextEvent.title : "Nothing scheduled"}
        sub={nextEvent ? (nextEvent.allDay ? `${sameDay(nextEvent.startsAt, now) ? "Today" : fmt(nextEvent.startsAt, { weekday: "short", day: "numeric", month: "short" })} · all day` : when(nextEvent.startsAt)) : null} />
      <Tile title="Tonight" onClick={() => go("recipes")} bg={bg}
        line={dinner === undefined ? "…" : dinner ? dinner.name : "Nothing planned"}
        sub={dinner ? null : dinner === null ? "Tap to plan dinners" : null} />
      <Tile title="Routines" count={routines.length} onClick={() => go("tasks")}
        line={routines[0] ? routines[0].title : "All done ✓"}
        sub={routines[0] ? [routines[0].member?.name, routines[0].cadence].filter(Boolean).join(" · ") : null} />
    </div>
  );
}

/* Fixed above the bottom bar, always in reach. */
export function JadeBar({ onTalk }) {
  return (
    <button type="button" className="jade-bar" onClick={onTalk}>
      <span className="voice-mark"><i /><i /><i /><i /></span> Talk to Jade
    </button>
  );
}

/* First open on a phone: whose is it? Asked once. */
export function WhoSheet({ members, onPick }) {
  return (
    <div className="modal-backdrop">
      <div className="event-detail-sheet sheet-card">
        <p className="eyebrow">WELCOME</p>
        <h2>Whose phone is this?</h2>
        <p className="sheet-note">Asked once. Reminders, tasks and Jade will be for this person.</p>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {members.map((m) => (
            <button key={m.id} type="button" className="chip-button" onClick={() => onPick(m)}
              style={{ padding: "12px 14px", fontSize: 16, textAlign: "left" }}>{m.name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Settings on a phone: who this phone belongs to. Once set, only a parent can change it. */
export function ThisPhone({ members, viewer, onChange }) {
  const [open, setOpen] = useState(false);
  const canChange = viewer?.role === "PARENT";
  return (
    <section className="agenda-card">
      <div className="section-title"><h2>This phone</h2></div>
      <p style={{ margin: "8px 0 0" }}>This phone is <strong>{viewer?.name || "not set"}</strong>'s.</p>
      {canChange ? (
        open ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {members.map((m) => (
              <button key={m.id} type="button" className="chip-button" onClick={() => { onChange(m); setOpen(false); }}
                style={m.id === viewer?.id ? { background: "var(--navy)", color: "#fff" } : undefined}>{m.name}</button>
            ))}
          </div>
        ) : <button type="button" className="chip-button" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>Change</button>
      ) : <p className="sheet-note" style={{ marginTop: 6 }}>Ask Mum or Dad if this needs changing.</p>}
    </section>
  );
}

/* Home only: Jade as a big circle in the space under the tiles. It shrinks
   as tiles are added above it, so the page never needs to scroll. */
export function JadeOrb({ onTalk }) {
  return (
    <div className="jade-stage">
      <button type="button" className="jade-orb" onClick={onTalk} aria-label="Talk to Jade">
        <span className="voice-mark"><i /><i /><i /><i /></span>
        <strong>Talk to Jade</strong>
      </button>
    </div>
  );
}

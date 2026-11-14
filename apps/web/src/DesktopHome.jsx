import React, { useEffect, useMemo, useState } from "react";
import { bucket, whenOf } from "./Tasks.jsx";
import { expandEvents } from "./rrule.js";
import { dayKey } from "./MealPlan.jsx";

/* Home on a desktop: use the space. The things that need doing sit at the
   top where the eye lands (To do today, Coming up side by side), the
   supporting cards run down the right (Tonight, Routines, Family at a
   glance), and the week ahead runs along the bottom. The phone has its own
   simpler Home (PhoneHome.jsx). */

const DAY = 86400000;
const KNOWN = ["rhian", "danielle", "lachie", "jack", "maddie"];
const colourOf = (m) => (m && KNOWN.includes(m.name.toLowerCase()) ? `var(--${m.name.toLowerCase()})` : "var(--navy)");
const fmt = (d, o) => new Intl.DateTimeFormat("en-AU", o).format(new Date(d));
const time = (d) => fmt(d, { hour: "numeric", minute: "2-digit" });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

const card = { background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: "16px 18px", boxShadow: "0 8px 24px #1d2a4a0a", minWidth: 0 };
const head = (title, action, onAction, tone) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
    <h2 style={{ margin: 0, fontSize: 18, flex: 1, color: tone || "var(--ink)" }}>{title}</h2>
    {action && <button type="button" onClick={onAction} style={{ border: 0, background: "none", color: "var(--navy)", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{action} →</button>}
  </div>
);
const Chip = ({ n, label, tone, onClick }) => (
  <button type="button" onClick={onClick}
    style={{ border: 0, cursor: "pointer", borderRadius: 14, padding: "8px 14px", minWidth: 92, textAlign: "left", font: "inherit",
             background: n ? "#ffffff" : "#ffffff26", color: n ? tone : "#ffffffcc", boxShadow: n ? "0 4px 12px #0002" : "none" }}>
    <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{n}</div>
    <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3 }}>{label}</div>
  </button>
);

export default function DesktopHome({ api, version, viewer, members, allTasks, openTasks, chores, events, everyone, unread,
                                       noticesEl, onHistory, onCompose, onOpenTask, toggleTask, toggleChore, go }) {
  const now = new Date();
  const today = startOfDay(now);
  const weekEnd = new Date(today.getTime() + 7 * DAY);

  const due = openTasks.filter((t) => ["overdue", "today"].includes(bucket(t, now)))
    .sort((a, b) => new Date(whenOf(a) || 0) - new Date(whenOf(b) || 0));
  const overdue = due.filter((t) => bucket(t, now) === "overdue").length;

  const occ = useMemo(() => expandEvents(events, today, weekEnd)
    .filter((e) => new Date(e.endsAt || e.startsAt) >= now && new Date(e.startsAt) < weekEnd)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)), [events, +today]);
  const routines = chores.filter((c) => !c.completed);

  const [dinner, setDinner] = useState(undefined);
  const [tomorrow, setTomorrow] = useState(null);
  useEffect(() => {
    api(`/api/plan?start=${dayKey(now)}`).then((w) => {
      setDinner(w.meals.find((m) => m.day === dayKey(now)) || null);
      setTomorrow(w.meals.find((m) => m.day === dayKey(new Date(now.getTime() + DAY))) || null);
    }).catch(() => setDinner(null));
  }, [version]);

  /* Who is on top of things - every person, whatever the Me/All view. */
  const family = members.map((m) => {
    const theirs = allTasks.filter((t) => t.status === "OPEN" && t.memberId === m.id);
    return { m, open: theirs.length, overdue: theirs.filter((t) => bucket(t, now) === "overdue").length,
             today: theirs.filter((t) => bucket(t, now) === "today").length, help: theirs.some((t) => t.needsHelp) };
  });

  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * DAY));
  const tasksOn = (d) => openTasks.filter((t) => whenOf(t) && startOfDay(whenOf(t)).getTime() === d.getTime());
  const eventsOn = (d) => occ.filter((e) => startOfDay(e.startsAt).getTime() === d.getTime());

  const taskRow = (t) => (
    <button key={t.id} type="button" onClick={() => onOpenTask(t)}
      style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", font: "inherit", cursor: "pointer",
               padding: "9px 10px", borderRadius: 12, border: "1px solid var(--line)", background: "#fbfcff", color: "var(--ink)" }}>
      <span className="task-check" title="Tick off" onClick={(ev) => { ev.stopPropagation(); toggleTask(t); }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 14 }}>{t.title}{t.needsHelp ? " 🙋" : ""}</strong>
        <small style={{ color: bucket(t, now) === "overdue" ? "var(--coral)" : "var(--muted)", fontWeight: bucket(t, now) === "overdue" ? 800 : 500 }}>
          {[bucket(t, now) === "overdue" ? "Overdue" : null, everyone || t.memberId !== viewer?.id ? (t.member?.name || "Unallocated") : null,
            whenOf(t) ? `${fmt(whenOf(t), { weekday: "short", day: "numeric", month: "short" })} ${time(whenOf(t))}` : null].filter(Boolean).join(" · ")}
        </small>
      </span>
      <span style={{ color: "#c3c7d0" }}>›</span>
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ---- your day ---- */}
      <section className="today-hero" style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px" }}>
          <p className="eyebrow" style={{ color: "#f0c987", margin: 0 }}>YOUR DAY · {fmt(now, { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</p>
          <h2 style={{ margin: "6px 0 4px", fontSize: 28 }}>{greeting()}{viewer ? `, ${viewer.name}` : ""}</h2>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.9 }}>
            {unread.length ? `${unread.length} new family notice${unread.length === 1 ? "" : "s"} below · ` : "✓ Everyone's up to date · "}
            <button type="button" onClick={onHistory} style={{ border: 0, background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>Recent activity</button>
            {" · "}
            <button type="button" onClick={onCompose} style={{ border: 0, background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>Notify family</button>
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Chip n={overdue} label="Overdue" tone="var(--coral)" onClick={() => go("tasks")} />
          <Chip n={due.length - overdue} label="Today" tone="var(--navy)" onClick={() => go("tasks")} />
          <Chip n={occ.length} label="This week" tone="var(--navy)" onClick={() => go("calendar")} />
        </div>
      </section>

      {noticesEl}

      {/* ---- main + side ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2.2fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <section style={{ ...card, borderTop: `4px solid ${overdue ? "var(--coral)" : "var(--sun)"}` }}>
            {head("To do today", "All tasks", () => go("tasks"))}
            <div style={{ display: "grid", gap: 8 }}>
              {due.slice(0, 8).map(taskRow)}
              {!due.length && <p style={{ color: "var(--muted)", margin: 0 }}>Nothing due today. 🎉</p>}
              {due.length > 8 && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>+ {due.length - 8} more</p>}
            </div>
          </section>

          <section style={{ ...card, borderTop: "4px solid var(--sky)" }}>
            {head("Coming up", "Calendar", () => go("calendar"))}
            <div style={{ display: "grid", gap: 2 }}>
              {occ.slice(0, 8).map((e) => (
                <div key={`${e.id}-${e.startsAt}`} style={{ display: "flex", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ width: 4, borderRadius: 4, background: colourOf(e.member), flex: "0 0 auto" }} />
                  <span style={{ width: 86, flex: "0 0 auto", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                    {startOfDay(e.startsAt).getTime() === today.getTime() ? "Today" : fmt(e.startsAt, { weekday: "short", day: "numeric" })}
                    <br />{e.allDay ? "All day" : time(e.startsAt)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14 }}>{e.title}</strong>
                    <small style={{ color: "var(--muted)" }}>{[e.location, e.member?.name || "Family"].filter(Boolean).join(" · ")}</small>
                  </span>
                </div>
              ))}
              {!occ.length && <p style={{ color: "var(--muted)", margin: 0 }}>Nothing in the next seven days.</p>}
            </div>
          </section>
        </div>

          {/* ---- the week ahead ---- */}
          <section style={card}>
            {head("The week ahead", "Calendar", () => go("calendar"))}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
              {days.map((d, i) => {
                const items = [...eventsOn(d).map((e) => ({ k: `e${e.id}${e.startsAt}`, t: e.title, c: colourOf(e.member) })),
                               ...tasksOn(d).map((t) => ({ k: `t${t.id}`, t: t.title, c: colourOf(t.member), task: true }))];
                return (
                  <div key={+d} style={{ borderRadius: 14, padding: "8px 8px 10px", minHeight: 96, minWidth: 0,
                                         background: i === 0 ? "color-mix(in srgb, var(--coral) 7%, white)" : "#fbfcff",
                                         border: `1px solid ${i === 0 ? "color-mix(in srgb, var(--coral) 40%, white)" : "var(--line)"}` }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: i === 0 ? "var(--coral)" : "var(--muted)", marginBottom: 6 }}>
                      {i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmt(d, { weekday: "short", day: "numeric" })}
                    </div>
                    {items.slice(0, 4).map((x) => (
                      <div key={x.k} title={x.t} style={{ fontSize: 12, lineHeight: 1.3, padding: "2px 0 2px 6px", borderLeft: `3px ${x.task ? "dashed" : "solid"} ${x.c}`,
                                                          marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.t}</div>
                    ))}
                    {items.length > 4 && <div style={{ fontSize: 11, color: "var(--muted)" }}>+{items.length - 4} more</div>}
                    {!items.length && <div style={{ fontSize: 12, color: "#c3c7d0" }}>Free</div>}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <section style={{ ...card, padding: 0, overflow: "hidden", cursor: "pointer" }} onClick={() => go("meals")}>
            <div style={{ height: 150, background: dinner?.recipe?.imageAt
              ? `center / cover no-repeat url("/api/recipes/${dinner.recipe.id}/image?v=${encodeURIComponent(dinner.recipe.imageAt)}")`
              : "linear-gradient(135deg, #ffe3c4, #ffd6dc 55%, #dcecff)", display: "grid", placeItems: "center", fontSize: 44 }}>
              {!dinner?.recipe?.imageAt && <span aria-hidden="true">🍽️</span>}
            </div>
            <div style={{ padding: "12px 16px 14px" }}>
              <p className="eyebrow" style={{ margin: 0 }}>TONIGHT'S DINNER</p>
              <h3 style={{ margin: "4px 0 2px", fontSize: 18 }}>{dinner === undefined ? "…" : dinner ? dinner.name : "Nothing planned yet"}</h3>
              <small style={{ color: "var(--muted)" }}>{dinner === null ? "Plan the week's dinners →" : `Tomorrow: ${tomorrow ? tomorrow.name : "not planned yet"}`}</small>
            </div>
          </section>

          {routines.length > 0 && (
            <section style={{ ...card, background: "color-mix(in srgb, var(--mint) 10%, white)" }}>
              {head(`Routines · ${routines.length}`)}
              {routines.slice(0, 4).map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", fontSize: 14 }}>{c.title}</strong>
                    <small style={{ color: "var(--muted)" }}>{[c.member?.name, c.cadence].filter(Boolean).join(" · ")}</small>
                  </span>
                  <button type="button" className="chip-button" onClick={() => toggleChore(c)} style={{ padding: "4px 12px" }}>Done</button>
                </div>
              ))}
            </section>
          )}

          <section style={card}>
            {head("Family at a glance", "Tasks", () => go("tasks"))}
            {family.map(({ m, open, overdue: o, today: d, help }) => (
              <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 900, color: "#fff", background: colourOf(m), flex: "0 0 auto" }}>{m.initials}</span>
                <strong style={{ flex: 1, fontSize: 14 }}>{m.name}{help ? " 🙋" : ""}</strong>
                <small style={{ fontWeight: 800, color: o ? "var(--coral)" : open ? "var(--muted)" : "var(--mint)" }}>
                  {o ? `${o} overdue` : d ? `${d} today` : open ? `${open} open` : "all clear ✓"}
                </small>
              </div>
            ))}
          </section>
        </div>
      </div>

    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { DAY_CODES, shortDay, parseRRule, buildRRule, describeRRule, expandEvents } from "./rrule.js";

/* The calendar, built to Rhian's own stylesheet. The geometry comes from
   his CSS: .day-schedule-grid is 1440px tall over 24 hours, so one pixel
   is one minute and an event's top/height are just its clock times. */

const DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KNOWN = ["rhian", "danielle", "lachie", "jack", "maddie"];
/* Waking to bedtime - the hours a family actually schedules into. */
const PLACE_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

/* Items that overlap in one person's column sit side by side, as in
   Outlook, instead of on top of each other. Works on drawn size, not real
   duration, because short items get a minimum height and can overlap
   visually when their times do not. Returns extra style per item; an item
   with nothing beside it gets nothing and keeps Rhian's own left/right. */
/* Shape says what kind it is, colour says whose: a square box for a to-do
   (filled once done), a round dot for an event - Rhian's own convention
   from his week cards. Colour alone fails anyone colour-blind. */
const kindMark = (isTask, done) => (
  <i aria-hidden="true" style={{
    display: "inline-block", width: 11, height: 11, marginRight: 6, verticalAlign: "-1px",
    borderRadius: isTask ? 3 : "50%",
    border: "2px solid var(--member-color)",
    background: isTask && !done ? "transparent" : "var(--member-color)",
    boxSizing: "border-box"
  }} />
);

function laneStyles(items) {
  const order = items.map((_, i) => i)
    .sort((a, b) => items[a].top - items[b].top || items[b].height - items[a].height);
  const out = items.map(() => ({}));
  const lane = [];
  let cluster = [], ends = [], clusterEnd = -1;
  const close = () => {
    const n = Math.max(...cluster.map((i) => lane[i])) + 1;
    if (n > 1) for (const i of cluster) {
      out[i] = { left: `calc(${(lane[i] * 100) / n}% + 4px)`, width: `calc(${100 / n}% - 8px)`, right: "auto" };
    }
    cluster = []; ends = []; clusterEnd = -1;
  };
  for (const i of order) {
    const { top, height } = items[i];
    if (cluster.length && top >= clusterEnd) close();
    let l = ends.findIndex((end) => end <= top);
    if (l === -1) { l = ends.length; ends.push(0); }
    ends[l] = top + height;
    lane[i] = l;
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, top + height);
  }
  if (cluster.length) close();
  return out;
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays    = (d, n) => new Date(startOfDay(d).getTime() + n * DAY);
const startOfWeek = (d) => addDays(d, -startOfDay(d).getDay());
const sameDay    = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const minutesInto = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };

const fmt = (d, o) => new Intl.DateTimeFormat("en-AU", o).format(d);
const hhmm = (d) => fmt(d, { hour: "numeric", minute: "2-digit" });

/* Colour comes from the member's colorKey, which maps to the CSS custom
   properties Rhian defined. Unassigned items read as "family". */
const personClass = (m) => {
  const k = String(m?.colorKey || m?.name || "").toLowerCase();
  return KNOWN.includes(k) ? `person-${k}` : "person-family";
};

function monthMatrix(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function Calendar({ events, tasks = [], members, calendars, viewer, onCreate, onUpdate, onDelete, onToggleTask, onOpenTask, onSchedule }) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  /* Seven columns do not fit a phone, so open on Day there. Read once at
     mount; after that the view is whatever the person chose. */
  const [view, setView] = useState(() => {
    try { return window.matchMedia("(max-width: 700px)").matches ? "day" : "week"; }
    catch { return "week"; }
  });
  const [hidden, setHidden] = useState(() => new Set());
  const [draft, setDraft]   = useState(null);
  const [notice, setNotice] = useState("");
  /* The task picked up from the rail: dragged on a desktop, or tapped then
     tapped again on a phone, where dragging is miserable. */
  const [carrying, setCarrying] = useState(null);

  const keyOf   = (e) => e.memberId ?? "family";

  /* A repeating event is one row with a rule; the views need the actual
     occurrences. Expanded over a window wide enough for any view, so paging
     a week or a month needs no refetch. */
  /* A task with a scheduledFor belongs on the calendar: "clean the shed,
     Saturday 9am" is a thing happening at a time. It is given a start and an
     end so it can sit in the grid, then goes through the same expansion -
     chores carry recurrence rules too. */
  const taskItems = useMemo(() => tasks
    .filter((t) => t.scheduledFor || t.dueAt)
    .map((t) => {
      if (t.scheduledFor) {
        const s = new Date(t.scheduledFor);
        return {
          ...t, isTask: true,
          startsAt: t.scheduledFor,
          endsAt: new Date(s.getTime() + (t.durationMins || 30) * 60000).toISOString()
        };
      }
      /* Due by a day but not yet given a time: shown on its due day as an
         all-day "Due" note, so a deadline is on the calendar without anyone
         having to schedule it first. It stays in Ready to schedule too. */
      const day = new Date(t.dueAt); day.setHours(0, 0, 0, 0);
      return {
        ...t, isTask: true, dueOnly: true, allDay: true,
        startsAt: day.toISOString(),
        endsAt: new Date(day.getTime() + 24 * 3600000 - 60000).toISOString()
      };
    }), [tasks]);

  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.scheduledFor && t.status !== "DONE"),
    [tasks]
  );

  const occurrences = useMemo(
    () => expandEvents([...events, ...taskItems], addDays(cursor, -45), addDays(cursor, 75)),
    [events, taskItems, cursor]
  );
  const visible = useMemo(() => occurrences.filter((e) => !hidden.has(keyOf(e))), [occurrences, hidden]);
  const onDay   = (d) => visible.filter((e) => sameDay(new Date(e.startsAt), d))
                                .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  const columns = useMemo(
    () => [...members.filter((m) => !hidden.has(m.id)), ...(hidden.has("family") ? [] : [null])],
    [members, hidden]
  );

  const step = (dir) => setCursor((c) =>
    view === "month" ? new Date(c.getFullYear(), c.getMonth() + dir, 1)
    : addDays(c, dir * (view === "week" ? 7 : 1)));

  const title =
    view === "day"   ? fmt(cursor, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  : view === "week"  ? `${fmt(startOfWeek(cursor), { day: "numeric", month: "short" })} – ${fmt(addDays(startOfWeek(cursor), 6), { day: "numeric", month: "short", year: "numeric" })}`
  :                    fmt(cursor, { month: "long", year: "numeric" });

  const toggle = (k) => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const inView = view === "day"
    ? visible.filter((e) => sameDay(new Date(e.startsAt), cursor)).length
    : view === "week"
      ? visible.filter((e) => { const d = new Date(e.startsAt); return d >= startOfWeek(cursor) && d < addDays(startOfWeek(cursor), 7); }).length
      : visible.filter((e) => new Date(e.startsAt).getMonth() === cursor.getMonth()).length;
  const subtitle = `${inView} ${inView === 1 ? "thing" : "things"} · ${hidden.size ? `${members.length + 1 - hidden.size} of ${members.length + 1} shown` : "everyone shown"}`;

  /* Dropping onto a person's column schedules it AND hands it to them -
     "drag it onto someone's day" is one gesture, not two. */
  const place = async (date, startMin, memberId) => {
    const task = carrying;
    setCarrying(null);
    const when = new Date(startOfDay(date).getTime() + startMin * 60000);
    await onSchedule(task, when.toISOString(), memberId);
  };

  const openDraft = (date, startMin = 9 * 60, memberId = viewer?.id ?? null) =>
    setDraft({ date: startOfDay(date), startMin, endMin: startMin + 60, memberId, title: "", location: "",
    allDay: false, recurrenceRule: null, isSeries: false, reminderMins: null });

  /* Opening an existing one. An event that reached the browser reduced to
     "Busy" never carried its real title, so editing it here would overwrite
     that title with the placeholder. Refuse, and say why. */
  const openEdit = (e) => {
    /* A to-do opens its card (Done / Talk) rather than ticking itself off -
       one stray tap was silently undoing people's work. Routines still tick. */
    if (e.isTask) return (e.kind && e.kind !== "TASK") ? onToggleTask?.(e) : onOpenTask?.(e);
    if (e.busy) return setNotice(`"${e.title}" is on a private calendar — it can only be changed where it lives.`);
    setNotice("");
    /* A repeating event is one row. Editing any occurrence edits the series,
       so the sheet works from the series' own date and times - otherwise
       saving from next Tuesday would quietly move the whole series there.
       Changing one occurrence alone is a separate job; the schema's
       recurrenceParentId and originalStartsAt exist for it. */
    const isSeries = Boolean(e.recurrenceRule);
    const s = new Date(isSeries ? (e.seriesStartsAt ?? e.startsAt) : e.startsAt);
    const t = new Date(isSeries ? (e.seriesEndsAt ?? e.endsAt) : e.endsAt);
    const end = sameDay(s, t) ? minutesInto(t) : 24 * 60 - 1;
    setDraft({
      id: e.seriesId ?? e.id,
      date: startOfDay(s), startMin: minutesInto(s), endMin: end,
      memberId: e.memberId ?? null, title: e.title, location: e.location || "",
      allDay: !!e.allDay, recurrenceRule: e.recurrenceRule || null, isSeries,
      reminderMins: e.reminderMins ?? null
    });
  };

  return (
    <div className="calendar-layout">
      <aside className="calendar-nav">
        <MiniCal cursor={cursor} onPick={setCursor} events={visible} />
        <div className="calendar-nav-note">
          Click any day to jump there. Click a slot in Day or Week to add something.
        </div>
      </aside>

      <section className="calendar-panel">
        <div className="calendar-toolbar">
          <div className="date-title">
            <button onClick={() => step(-1)} aria-label="Previous">‹</button>
            <button onClick={() => step(1)} aria-label="Next">›</button>
            <button className="today-button" onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="calendar-toolbar-controls">
            <div className="view-switch">
              {["day", "week", "month"].map((v) => (
                <button key={v} className={view === v ? "selected" : ""} onClick={() => setView(v)}>
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <button className="calendar-add-item" onClick={() => openDraft(cursor)}>+ Add item</button>
          </div>
        </div>

        <div className="family-filters">
          <span className="filter-label">Showing</span>
          {members.map((m) => (
            <button
              key={m.id}
              className={`person-filter ${personClass(m)} ${hidden.has(m.id) ? "muted" : "selected"}`}
              onClick={() => toggle(m.id)}
              title={hidden.has(m.id) ? `Show ${m.name}` : `Hide ${m.name}`}
            >
              <span>{m.initials}</span>{m.name}
            </button>
          ))}
          <button
            className={`person-filter person-family ${hidden.has("family") ? "muted" : "selected"}`}
            onClick={() => toggle("family")}
          >
            <span>ALL</span>Family
          </button>
        </div>

        {view === "month" && <MonthView cursor={cursor} onDay={onDay} onOpen={openEdit}
                                        onPick={(d) => { setCursor(d); setView("day"); }} onAdd={openDraft} />}
        {view === "week"  && <WeekView  cursor={cursor} onDay={onDay} onAdd={openDraft} onOpen={openEdit}
                                        onPick={(d) => { setCursor(d); setView("day"); }} />}
        {view === "day"   && (
          <DayView
            cursor={cursor} columns={columns} events={visible}
            onAdd={openDraft} onOpen={openEdit}
            unscheduled={unscheduled} carrying={carrying} setCarrying={setCarrying} onPlace={place}
          />
        )}
        {view !== "day" && unscheduled.length > 0 && (
          <p className="rail-hint">
            {unscheduled.length} {unscheduled.length === 1 ? "task has" : "tasks have"} no time yet —
            {" "}<button className="notice-history-link" onClick={() => setView("day")}>schedule them in Day view</button>
          </p>
        )}
      </section>

      {notice && <div className="alert calendar-notice" onClick={() => setNotice("")}>{notice}</div>}

      {draft && (
        <EventSheet
          draft={draft} setDraft={setDraft} members={members} calendars={calendars}
          onCancel={() => setDraft(null)} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------- mini calendar */

function MiniCal({ cursor, onPick, events }) {
  const [shown, setShown] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const cells = monthMatrix(shown);
  const today = startOfDay(new Date());
  const busy = useMemo(() => {
    const s = new Set();
    for (const e of events) s.add(startOfDay(new Date(e.startsAt)).getTime());
    return s;
  }, [events]);

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <button onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
        <strong>{fmt(shown, { month: "long", year: "numeric" })}</strong>
        <button onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))} aria-label="Next month">›</button>
      </div>
      <div className="mini-cal-grid">
        {WEEKDAYS.map((d) => <span key={d} className="mini-cal-weekday">{d[0]}</span>)}
        {cells.map((d) => {
          const cls = [
            "mini-cal-day",
            d.getMonth() !== shown.getMonth() ? "outside" : "",
            sameDay(d, cursor) ? "picked" : "",
            sameDay(d, today) ? "today" : "",
            busy.has(d.getTime()) ? "busy" : ""
          ].filter(Boolean).join(" ");
          return <button key={d.getTime()} className={cls} onClick={() => onPick(d)}>{d.getDate()}</button>;
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- month view */

function MonthView({ cursor, onDay, onPick, onAdd, onOpen }) {
  const cells = monthMatrix(cursor);
  const today = startOfDay(new Date());
  return (
    <div className="month-grid">
      {WEEKDAYS.map((d) => <div key={d} className="month-weekday">{d}</div>)}
      {cells.map((d) => {
        const items = onDay(d);
        return (
          <div
            key={d.getTime()}
            className={`month-cell ${d.getMonth() !== cursor.getMonth() ? "outside" : ""} ${sameDay(d, today) ? "is-today" : ""}`}
            onDoubleClick={() => onAdd(d)}
          >
            <div className="month-cell-date" onClick={() => onPick(d)}>{d.getDate()}</div>
            <div className="month-items">
              {items.slice(0, 3).map((e) => (
                <button
                  key={e.id}
                  className={`month-calendar-item ${personClass(e.member)} ${e.isTask ? "is-task" : ""} ${e.status === "DONE" ? "is-done" : ""}`}
                  onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                  title={e.isTask ? `${e.title} — tap to ` : e.title}
                >
                  <span className="month-item-time">{e.allDay ? "all day" : hhmm(new Date(e.startsAt))}</span>
                  <span className="person-dot" />
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
              {items.length > 3 && (
                <button className="month-more" onClick={() => onPick(d)}>+{items.length - 3} more</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- week view */

function WeekView({ cursor, onDay, onAdd, onPick, onOpen }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));
  const today = startOfDay(new Date());
  return (
    <div className="week-grid">
      {days.map((d) => (
        <div key={d.getTime()} className={`day-column ${sameDay(d, today) ? "is-today" : ""}`}>
          <header className="week-day-head" onClick={() => onPick(d)}>
            <span>{WEEKDAYS[d.getDay()]}</span>
            <strong>{d.getDate()}</strong>
          </header>
          <div className="day-content" onDoubleClick={() => onAdd(d)}>
            {onDay(d).map((e) => (
              <button
                key={e.id} type="button"
                className={`calendar-card ${personClass(e.member)} ${e.isTask ? "task-event" : ""} ${e.recurrenceRule ? "routine" : ""} ${e.status === "DONE" ? "is-done" : ""}`}
                onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                title={e.isTask ? `${e.title} — tap to ` : e.title}
              >
                {e.isTask && <span className="event-kind"><i />{e.status === "DONE" ? "Done" : e.dueOnly ? "Due" : "To do"}</span>}
                <span className="event-time">{e.allDay ? "All day" : hhmm(new Date(e.startsAt))}</span>
                {/* h3, not strong: Rhian styled .calendar-card h3 as the title block. */}
                <h3>{e.title}</h3>
                {(e.member || e.location) && (
                  <span className="event-owner">{[e.member?.name, e.location].filter(Boolean).join(" · ")}</span>
                )}
              </button>
            ))}
            {!onDay(d).length && <div className="week-empty">—</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- day view */

function DayView({ cursor, columns, events, onAdd, onOpen, unscheduled, carrying, setCarrying, onPlace }) {
  const forDay = events.filter((e) => sameDay(new Date(e.startsAt), cursor));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  /* The grid is a full 24 hours and one pixel is one minute, so it opens at
     midnight - which on a phone is a screen of empty night. Start at the
     first thing on, or at 7am when the day is clear. */
  const scrollRef = useRef(null);
  const firstAt = forDay.length
    ? Math.min(...forDay.map((e) => { const d = new Date(e.startsAt); return d.getHours() * 60 + d.getMinutes(); }))
    : 7 * 60;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, firstAt - 40);
  }, [+cursor, firstAt]);

  /* A column per person needs about 190px each; a phone fits one and a half.
     So on a phone the day is read as a list instead - the person is their
     colour and their initials rather than a column you have to swipe to. */
  const [phone, setPhone] = useState(() => {
    try { return window.matchMedia("(max-width: 700px)").matches; } catch { return false; }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia("(max-width: 700px)");
      const on = (e) => setPhone(e.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    } catch { return undefined; }
  }, []);

  /* The rail sits under the day, so picking a task leaves the times off the
     top of the screen. Bring them to the eye rather than ask for a scroll. */
  const placeRef = useRef(null);
  useEffect(() => {
    if (phone && carrying && placeRef.current) {
      placeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [phone, carrying]);

  /* All-day things first, then in clock order. */
  const agenda = [...forDay].sort((a, b) =>
    (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || new Date(a.startsAt) - new Date(b.startsAt));

  // One pixel is one minute; snap to the nearest quarter hour.
  const minutesAt = (ev) =>
    Math.max(0, Math.min(23 * 60, Math.round(ev.nativeEvent.offsetY / 15) * 15));

  const click = (ev, memberId) => {
    if (carrying) return onPlace(cursor, minutesAt(ev), memberId);
    onAdd(cursor, minutesAt(ev), memberId);
  };

  const drop = (ev, memberId) => {
    ev.preventDefault();
    if (!carrying) return;
    onPlace(cursor, minutesAt(ev), memberId);
  };

  return (
    <div className="day-with-tasks">
      <aside className="day-task-panel">
        <div className="panel-heading">
          <h2>Ready to schedule</h2>
          <span className="count-badge">{unscheduled.length}</span>
        </div>
        <p className="panel-intro">
          {carrying
            ? (phone ? `Now pick a time above to place "${carrying.title}".`
                     : `Now click a time in someone's day to place "${carrying.title}".`)
            : phone ? "Tap one, then tap a time."
                    : "Drag one onto a person's day, or click it then click a time."}
        </p>
        <div className="day-task-list">
          {unscheduled.map((t) => (
            <div
              key={`${t.kind}-${t.id}`}
              className={`day-task-drag ${personClass(t.member)} ${carrying?.id === t.id ? "is-dragging" : ""}`}
              draggable
              onDragStart={() => setCarrying(t)}
              onDragEnd={() => setCarrying(null)}
              onClick={() => setCarrying(carrying?.id === t.id ? null : t)}
              title="Drag onto a day, or click then click a time"
            >
              <i className="drag-grip">⋮⋮</i>
              <div>
                <strong>{t.title}</strong>
                <small>{t.member?.name || "Unallocated"}{t.list?.name ? ` · ${t.list.name}` : ""}</small>
              </div>
              <span className="task-when">{t.dueAt ? `due ${fmt(new Date(t.dueAt), { day: "numeric", month: "short" })}` : ""}</span>
            </div>
          ))}
          {!unscheduled.length && <p className="empty-capture">Everything has a time.</p>}
        </div>
      </aside>

    {phone ? (
    <div className="day-schedule-shell day-agenda-shell">
      {carrying && (
        <div className="agenda-place" ref={placeRef}>
          <strong>Place &ldquo;{carrying.title}&rdquo;</strong>
          <div className="agenda-times">
            {PLACE_HOURS.map((h) => (
              <button key={h} onClick={() => onPlace(cursor, h * 60, carrying.memberId ?? carrying.member?.id ?? null)}>
                {h === 12 ? "12 pm" : h < 12 ? `${h} am` : `${h - 12} pm`}
              </button>
            ))}
          </div>
          <button type="button" className="chip-button" onClick={() => setCarrying(null)}>Cancel</button>
        </div>
      )}
      <ol className="day-agenda">
        {agenda.map((e) => {
          const s = new Date(e.startsAt), t = new Date(e.endsAt);
          return (
            <li
              key={e.id}
              className={`agenda-row ${personClass(e.member)} ${e.isTask ? "is-task" : ""} ${e.status === "DONE" ? "is-done" : ""}`}
              onClick={() => onOpen(e)}
            >
              <span className="agenda-time">{e.allDay ? "All day" : hhmm(s)}</span>
              <span className="agenda-bar" />
              <div className="agenda-body">
                <strong>{e.title}</strong>
                <small>
                  {[e.isTask ? (e.status === "DONE" ? "Done" : e.dueOnly ? "Due" : "To do")
                             : e.allDay ? null : `until ${hhmm(t)}`,
                    e.location, e.member?.name || "Family"].filter(Boolean).join(" \u00b7 ")}
                </small>
              </div>
              <span className="agenda-who">{e.member?.initials || "ALL"}</span>
            </li>
          );
        })}
        {!agenda.length && (
          <li className="agenda-empty">
            Nothing on today.
            <button type="button" className="chip-button" onClick={() => onAdd(cursor, 9 * 60, null)}>Add something</button>
          </li>
        )}
      </ol>
      <div className="day-schedule-tip">
        {carrying ? <strong>Pick a time above</strong> : "Tap anything to open it"}
      </div>
    </div>
    ) : (
    <div className="day-schedule-shell">
      <div className="day-schedule-scroll" ref={scrollRef}>
        <div
          className="day-schedule-grid"
          style={{ gridTemplateColumns: `76px repeat(${columns.length}, minmax(190px, 1fr))` }}
        >
          <div className="day-corner">Time</div>
          {columns.map((m, i) => (
            <div key={m?.id ?? `fam${i}`} className={`day-person-header ${personClass(m)}`}>
              <span className="person-dot" />
              <strong>{m ? m.name : "Family"}</strong>
            </div>
          ))}

          <div className="day-time-axis">
            {hours.map((h) => (
              <span key={h} className="day-hour" style={{ top: h * 60 }}>
                {h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`}
              </span>
            ))}
          </div>

          {columns.map((m, i) => (
            <div
              key={m?.id ?? `famcol${i}`}
              className={`day-person-column ${carrying ? "is-target" : ""}`}
              onClick={(ev) => click(ev, m?.id ?? null)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={(ev) => drop(ev, m?.id ?? null)}
              title={carrying ? `Place "${carrying.title}" here` : "Click to add something here"}
            >
              {(() => {
                const items = forDay.filter((e) => (e.memberId ?? null) === (m?.id ?? null)).map((e) => {
                  const s = new Date(e.startsAt), t = new Date(e.endsAt);
                  const top = e.allDay ? 0 : minutesInto(s);
                  /* A 30-minute task is a 30px block - too short to read a name in.
                     Short items get a visual floor while keeping their real
                     duration; the same compromise every calendar makes. */
                  const height = e.allDay ? 28 : Math.max(e.isTask ? 46 : 30, (t - s) / 60000);
                  return { e, s, t, top, height };
                });
                const lanes = laneStyles(items);
                return items.map(({ e, s, t, top, height }, idx) => {
                  /* Too short for label, title and time: one line, time first.
                     The full title is still in the hover text. */
                  const short = !e.allDay && height < (e.isTask ? 44 : 58);
                  return (
                    <div
                      key={e.id}
                      className={`day-event-block ${personClass(e.member)} ${e.isTask ? "day-event-task" : ""} ${e.status === "DONE" ? "is-done" : ""}`}
                      style={{ top, height, ...lanes[idx] }}
                      onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                      title={e.isTask ? `${e.title} — tap to ` : e.title}
                    >
                      {short ? (
                        <strong style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {kindMark(e.isTask, e.status === "DONE")}{e.isTask ? "" : `${hhmm(s)} · `}{e.title}
                        </strong>
                      ) : (
                        <>
                          <span>{kindMark(e.isTask, e.status === "DONE")}{e.isTask ? (e.status === "DONE" ? "Done" : e.dueOnly ? "Due today" : "To do") : e.allDay ? "All day" : e.busy ? "Busy" : "Meeting / appt"}</span>
                          <strong>{e.title}</strong>
                          {!e.allDay && !e.isTask && <small>{hhmm(s)} – {hhmm(t)}{e.location ? ` · ${e.location}` : ""}</small>}
                        </>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          ))}
        </div>
      </div>
      <div className="day-schedule-tip">
        {carrying
          ? <strong>Click a time to place “{carrying.title}”</strong>
          : "Click an empty slot to add something · times snap to 15 minutes"}
      </div>
    </div>
    )}
    </div>
  );
}

/* ------------------------------------------------------------ add an event */

/* Rhian styled .event-recurrence-editor and .recurring-day-picks for a dark
   panel; the colours are re-stated in our CSS for this white sheet. */
function Recurrence({ draft, set }) {
  const rule = parseRRule(draft.recurrenceRule);
  const change = (patch) => {
    const next = { ...rule, ...patch };
    // Picking Weekly with no days chosen defaults to the day it already falls on.
    if (next.freq === "WEEKLY" && !next.byday.length) next.byday = [DAY_CODES[draft.date.getDay()]];
    if (next.freq !== "WEEKLY") next.byday = [];
    set({ recurrenceRule: buildRRule(next) });
  };
  const toggleDay = (code) => {
    const has = rule.byday.includes(code);
    const byday = has ? rule.byday.filter((d) => d !== code) : [...rule.byday, code];
    // Never leave a weekly rule with no days; that would repeat nothing.
    change({ byday: byday.length ? DAY_CODES.filter((d) => byday.includes(d)) : rule.byday });
  };

  return (
    <div className="event-recurrence-editor">
      <label className="recurrence-top">Repeats
        <select value={rule.freq} onChange={(e) => change({ freq: e.target.value })}>
          <option value="">Does not repeat</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </label>

      {rule.freq && (
        <>
          {rule.freq === "WEEKLY" && (
            <div className="recurring-day-picks">
              {DAY_CODES.map((code) => (
                <label key={code}>
                  <input type="checkbox" checked={rule.byday.includes(code)} onChange={() => toggleDay(code)} />
                  <span>{shortDay(code)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="event-recurrence-fields">
            <label>Every
              <input type="number" min="1" max="52" value={rule.interval}
                     onChange={(e) => change({ interval: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label>Until <small>(optional)</small>
              <input type="date" value={rule.until} onChange={(e) => change({ until: e.target.value })} />
            </label>
          </div>
          <p className="recurrence-summary">{describeRRule(draft.recurrenceRule)}</p>
        </>
      )}
    </div>
  );
}

const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const fromTime = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

function EventSheet({ draft, setDraft, members, calendars, onCancel, onCreate, onUpdate, onDelete }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const editing = Boolean(draft.id);
  const set = (patch) => setDraft({ ...draft, ...patch });

  const submit = async (e) => {
    e.preventDefault();
    if (!draft.title.trim()) return setError("Give it a name.");
    if (!draft.allDay && draft.endMin <= draft.startMin) return setError("It has to finish after it starts.");
    setBusy(true); setError("");
    const at = (mins) => new Date(draft.date.getTime() + mins * 60000).toISOString();
    const cal = calendars?.find((c) => c.memberId === draft.memberId)
             ?? calendars?.find((c) => !c.memberId);
    const payload = {
      title: draft.title.trim(),
      location: draft.location.trim() || null,
      memberId: draft.memberId || null,
      calendarId: cal?.id,
      allDay: draft.allDay,
      recurrenceRule: draft.recurrenceRule,
      reminderMins: draft.reminderMins ?? null,
      startsAt: draft.allDay ? at(0) : at(draft.startMin),
      endsAt:   draft.allDay ? at(23 * 60 + 59) : at(draft.endMin)
    };
    try {
      editing ? await onUpdate(draft.id, payload) : await onCreate(payload);
      onCancel();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError("");
    try { await onDelete(draft.id); onCancel(); }
    catch (err) { setError(err.message); setBusy(false); setConfirming(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <p className="eyebrow">{editing ? "EDIT" : "NEW ITEM"}</p>
        <h2>{fmt(draft.date, { weekday: "long", day: "numeric", month: "long" })}</h2>

        <label>What is it?
          <input value={draft.title} autoFocus onChange={(e) => set({ title: e.target.value })}
                 placeholder="e.g. Lachie's match" />
        </label>

        <div className="sheet-row">
          <label>Who
            <select value={draft.memberId ?? ""} onChange={(e) => set({ memberId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Whole family</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Where
            <input value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="optional" />
          </label>
        </div>

        <div className="sheet-row">
          <label>Starts
            <input type="time" disabled={draft.allDay} value={toTime(draft.startMin)}
                   onChange={(e) => set({ startMin: fromTime(e.target.value) })} />
          </label>
          <label>Ends
            <input type="time" disabled={draft.allDay} value={toTime(draft.endMin)}
                   onChange={(e) => set({ endMin: fromTime(e.target.value) })} />
          </label>
          <label className="sheet-check">
            <input type="checkbox" checked={draft.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
            All day
          </label>
        </div>

        <Recurrence draft={draft} set={set} />

        <div className="sheet-row">
          <label>Remind
            <select
              value={draft.reminderMins ?? ""}
              onChange={(e) => set({ reminderMins: e.target.value === "" ? null : Number(e.target.value) })}
            >
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

        {draft.isSeries && (
          <p className="sheet-note">
            This repeats. Changes apply to every occurrence — changing one date on its own is not possible yet.
          </p>
        )}

        {error && <div className="alert">{error}</div>}

        <div className="sheet-actions">
          {editing && (confirming ? (
            <>
              <span className="sheet-confirm">
                {draft.isSeries ? "Delete every occurrence, for everyone?" : "Delete it for everyone?"}
              </span>
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
                {busy ? "Saving…" : editing ? "Save changes" : "Add to calendar"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

import React, { useMemo, useState } from "react";

/* The calendar, built to Rhian's own stylesheet. The geometry comes from
   his CSS: .day-schedule-grid is 1440px tall over 24 hours, so one pixel
   is one minute and an event's top/height are just its clock times. */

const DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KNOWN = ["rhian", "danielle", "lachie", "jack", "maddie"];

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

export default function Calendar({ events, members, calendars, viewer, onCreate, onUpdate, onDelete }) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [view, setView]     = useState("week");
  const [hidden, setHidden] = useState(() => new Set());
  const [draft, setDraft]   = useState(null);
  const [notice, setNotice] = useState("");

  const keyOf   = (e) => e.memberId ?? "family";
  const visible = useMemo(() => events.filter((e) => !hidden.has(keyOf(e))), [events, hidden]);
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

  const openDraft = (date, startMin = 9 * 60, memberId = viewer?.id ?? null) =>
    setDraft({ date: startOfDay(date), startMin, endMin: startMin + 60, memberId, title: "", location: "", allDay: false });

  /* Opening an existing one. An event that reached the browser reduced to
     "Busy" never carried its real title, so editing it here would overwrite
     that title with the placeholder. Refuse, and say why. */
  const openEdit = (e) => {
    if (e.busy) return setNotice(`"${e.title}" is on a private calendar — it can only be changed where it lives.`);
    const s = new Date(e.startsAt), t = new Date(e.endsAt);
    const end = sameDay(s, t) ? minutesInto(t) : 24 * 60 - 1;
    setNotice("");
    setDraft({
      id: e.id, date: startOfDay(s), startMin: minutesInto(s), endMin: end,
      memberId: e.memberId ?? null, title: e.title, location: e.location || "", allDay: !!e.allDay
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
        {view === "day"   && <DayView   cursor={cursor} columns={columns} events={visible} onAdd={openDraft} onOpen={openEdit} />}
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
                <button key={e.id} className={`month-calendar-item ${personClass(e.member)}`}
                        onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}>
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
              <button key={e.id} type="button" className={`calendar-card ${personClass(e.member)}`}
                      onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}>
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

function DayView({ cursor, columns, events, onAdd, onOpen }) {
  const forDay = events.filter((e) => sameDay(new Date(e.startsAt), cursor));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  const click = (ev, memberId) => {
    // One pixel is one minute; snap to the nearest quarter hour.
    const y = ev.nativeEvent.offsetY;
    onAdd(cursor, Math.max(0, Math.min(23 * 60, Math.round(y / 15) * 15)), memberId);
  };

  return (
    <div className="day-schedule-shell">
      <div className="day-schedule-scroll">
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
              className="day-person-column"
              onClick={(ev) => click(ev, m?.id ?? null)}
              title="Click to add something here"
            >
              {forDay.filter((e) => (e.memberId ?? null) === (m?.id ?? null)).map((e) => {
                const s = new Date(e.startsAt), t = new Date(e.endsAt);
                const top = e.allDay ? 0 : minutesInto(s);
                const height = e.allDay ? 28 : Math.max(30, (t - s) / 60000);
                return (
                  <div
                    key={e.id}
                    className={`day-event-block ${personClass(e.member)}`}
                    style={{ top, height }}
                    onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                  >
                    <span>{e.allDay ? "All day" : e.busy ? "Busy" : "Meeting / appt"}</span>
                    <strong>{e.title}</strong>
                    {!e.allDay && <small>{hhmm(s)} – {hhmm(t)}{e.location ? ` · ${e.location}` : ""}</small>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="day-schedule-tip">Click an empty slot to add something · times snap to 15 minutes</div>
    </div>
  );
}

/* ------------------------------------------------------------ add an event */

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

        {error && <div className="alert">{error}</div>}

        <div className="sheet-actions">
          {editing && (confirming ? (
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
                {busy ? "Saving…" : editing ? "Save changes" : "Add to calendar"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

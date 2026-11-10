/* Recurrence rules, the iCalendar way (RFC 5545) — the same strings Outlook,
   Google and Apple use, so when Microsoft sync lands a rule survives the round
   trip untranslated.

   We handle the subset a family actually needs: daily, weekly on chosen days,
   and monthly on the same date, with an interval and an optional end date. */

export const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_NAMES = { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" };
const DAY_SHORT = { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" };
const DAY = 86400000;

export function parseRRule(rule) {
  if (!rule) return { freq: "", byday: [], interval: 1, until: "" };
  const part = (k) => (new RegExp(`${k}=([^;]+)`).exec(rule) || [])[1] || "";
  const until = part("UNTIL");
  return {
    freq: part("FREQ"),
    byday: part("BYDAY") ? part("BYDAY").split(",") : [],
    interval: Number(part("INTERVAL")) || 1,
    // UNTIL is stored as YYYYMMDD(THHMMSSZ); the editor wants YYYY-MM-DD.
    until: until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : ""
  };
}

export function buildRRule({ freq, byday = [], interval = 1, until = "" }) {
  if (!freq) return null;
  const bits = [`FREQ=${freq}`];
  if (interval > 1) bits.push(`INTERVAL=${interval}`);
  if (freq === "WEEKLY" && byday.length) bits.push(`BYDAY=${byday.join(",")}`);
  if (until) bits.push(`UNTIL=${until.replace(/-/g, "")}T235959Z`);
  return bits.join(";");
}

export function describeRRule(rule) {
  const { freq, byday, interval, until } = parseRRule(rule);
  if (!freq) return "";
  const every = interval > 1 ? `every ${interval} ` : "every ";
  let text =
      freq === "DAILY"   ? `${every}${interval > 1 ? "days" : "day"}`
    : freq === "WEEKLY"  ? (byday.length
        ? `${every}${interval > 1 ? "weeks" : "week"} on ${byday.map((d) => DAY_NAMES[d] || d).join(", ")}`
        : `${every}${interval > 1 ? "weeks" : "week"}`)
    : freq === "MONTHLY" ? `${every}${interval > 1 ? "months" : "month"}`
    : "repeats";
  if (until) text += `, until ${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(until))}`;
  return text;
}

export const shortDay = (code) => DAY_SHORT[code] || code;

const atSameClock = (template, d) => {
  const x = new Date(d);
  x.setHours(template.getHours(), template.getMinutes(), 0, 0);
  return x;
};

/* Turns a series into the occurrences that fall inside [from, to].
   Occurrences after the first are virtual: they have no row of their own, so
   they carry seriesId and a composite id. Editing one edits the series — per
   occurrence overrides are a later job, which is what Event.recurrenceParentId
   and originalStartsAt exist for. */
export function expandEvents(events, from, to) {
  const out = [];
  for (const e of events) {
    if (!e.recurrenceRule) { out.push(e); continue; }

    const { freq, byday, interval, until } = parseRRule(e.recurrenceRule);
    const start = new Date(e.startsAt);
    const duration = new Date(e.endsAt) - start;
    const stop = until ? new Date(`${until}T23:59:59`) : null;
    const limit = Math.min(to, stop ?? to);
    const step = Math.max(1, interval);

    const push = (d) => {
      if (d < from || d > limit || d < new Date(new Date(start).setHours(0, 0, 0, 0))) return;
      const s = atSameClock(start, d);
      if (s < from || s > limit) return;
      out.push({
        ...e,
        id: `${e.id}@${s.toISOString().slice(0, 10)}`,
        // seriesId is the row that actually exists. Every occurrence carries
        // it, including the first: when BYDAY excludes the start's own
        // weekday, no occurrence sits on the original row's date, so the
        // caller can never rely on finding a "real" one.
        seriesId: e.id,
        seriesStartsAt: e.startsAt,
        seriesEndsAt: e.endsAt,
        virtual: s.getTime() !== start.getTime(),
        startsAt: s.toISOString(),
        endsAt: new Date(s.getTime() + duration).toISOString()
      });
    };

    let guard = 0;
    if (freq === "DAILY") {
      for (let d = new Date(start); d <= limit && guard++ < 800; d = new Date(d.getTime() + step * DAY)) push(d);
    } else if (freq === "WEEKLY") {
      const days = byday.length ? byday.map((c) => DAY_CODES.indexOf(c)).filter((i) => i >= 0) : [start.getDay()];
      // Walk week by week from the series start, emitting each chosen weekday.
      const weekStart = new Date(start); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      for (let w = new Date(weekStart); w <= limit && guard++ < 400; w = new Date(w.getTime() + step * 7 * DAY)) {
        for (const dow of days) push(new Date(w.getTime() + dow * DAY));
      }
    } else if (freq === "MONTHLY") {
      for (let i = 0; i < 400 && guard++ < 400; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i * step, start.getDate());
        if (d > limit) break;
        push(d);
      }
    } else {
      out.push(e);
    }
  }
  return out;
}

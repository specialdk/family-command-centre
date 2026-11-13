// Reminders: the clock-driven half of push.
//
// Every five minutes, work out which events and tasks are due a reminder and
// push it to the right person, once.
//
// Lead time - how long before it starts:
//   item.reminderMins = null  -> the family default (FamilySetting, 30 min)
//   item.reminderMins = 0     -> at the time
//   item.reminderMins = N     -> N minutes before (up to 1 day)
//   item.reminderMins = -1    -> no reminder
//
// Who hears about it:
//   events - the person it belongs to; a whole-family event goes to everyone
//   tasks  - the person it is assigned to (unassigned tasks remind nobody)
//
// Rules:
// - Only FULL-visibility events. A busy-only or private calendar (e.g. a work
//   calendar brought in from outside) already reminds its owner where it lives.
// - All-day events are skipped for now: "30 minutes before midnight" helps no one.
// - Recurring tasks (chores) are skipped until they get per-occurrence "done".
// - Quiet hours: a reminder that falls overnight waits until quiet hours end,
//   unless the thing itself is overnight too (an early flight still gets one).
// - No duplicates: ReminderLog is claimed BEFORE sending, and its unique
//   constraint means a second claim - a re-run, a restart, a second server -
//   simply fails and is skipped.
// - A reminder missed by more than 15 minutes (server was down) is dropped,
//   not sent late.
//
// Routes (mounted at /api/reminders, behind the family sign-in):
//   GET   /settings          family default lead time and quiet hours
//   PATCH /settings          change them
//   GET   /upcoming?hours=24 what WILL fire, without sending anything
//   POST  /run               run one pass now (for testing) and report it

import { Router } from "express";
import { expandEvents } from "../../web/src/rrule.js";
import { reduceEvent, WITH_VISIBILITY } from "./visibility.js";

const MIN = 60 * 1000;
const TICK_MS = 1 * MIN;
const CATCH_UP_MS = 15 * MIN;
const MAX_LEAD = 1440; // one day
export const NO_REMINDER = -1;

/// Normalises a reminderMins value from a request: null = family default.
export function cleanReminderMins(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < NO_REMINDER || n > MAX_LEAD) return null;
  return n;
}

const parseHHMM = (s, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return fallback;
  return +m[1] * 60 + +m[2];
};

export function createReminders({ prisma, push, familyTz }) {
  // ------------------------------------------------------------ time helpers

  const minutesOfDay = (d) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: familyTz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d);
    return +parts.find((p) => p.type === "hour").value * 60 + +parts.find((p) => p.type === "minute").value;
  };
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d);
  const clock = (d) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: familyTz, hour: "numeric", minute: "2-digit" }).format(d);

  const inQuiet = (mins, qs, qe) =>
    qs === qe ? false : qs > qe ? mins >= qs || mins < qe : mins >= qs && mins < qe;

  async function getSettings() {
    return prisma.familySetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  // ----------------------------------------------------------------- planning

  /// Every reminder whose send time falls in [from, to]. Sends nothing.
  async function plan(from, to) {
    const s = await getSettings();
    const qs = parseHHMM(s.quietStart, 21 * 60 + 30);
    const qe = parseHHMM(s.quietEnd, 6 * 60 + 30);
    const horizon = new Date(to.getTime() + MAX_LEAD * MIN);

    const everyone = (await prisma.familyMember.findMany({ select: { id: true } })).map((m) => m.id);

    // When to send, after the lead time and quiet hours. Null = no reminder.
    // changedAt: when the item was added or last edited. If that was after
    // the normal send time, remind straight away - something added at short
    // notice ("pick Jack up at 4", entered at 3:50) needs it most.
    const sendTimeFor = (start, reminderMins, changedAt) => {
      const lead = reminderMins ?? s.reminderLeadMins;
      if (lead < 0) return null;
      let sendAt = new Date(start.getTime() - Math.min(lead, MAX_LEAD) * MIN);
      if (changedAt && changedAt > sendAt && changedAt < start) sendAt = new Date(changedAt);
      const m = minutesOfDay(sendAt);
      if (inQuiet(m, qs, qe) && !inQuiet(minutesOfDay(start), qs, qe)) {
        sendAt = new Date(sendAt.getTime() + ((qe - m + 1440) % 1440) * MIN);
        if (sendAt > start) sendAt = start;
      }
      return sendAt;
    };

    const out = [];

    // Events - one-offs in range, plus every series that could have an
    // occurrence in range. Moved/cancelled single occurrences are a later job.
    const events = await prisma.event.findMany({
      where: {
        cancelled: false,
        allDay: false,
        recurrenceParentId: null,
        OR: [
          { recurrenceRule: null, startsAt: { gte: from, lte: horizon } },
          { recurrenceRule: { not: null }, startsAt: { lte: horizon } },
        ],
      },
      include: WITH_VISIBILITY,
    });

    for (const occ of expandEvents(events, from, horizon)) {
      const start = new Date(occ.startsAt);
      if (start < from || start > horizon) continue;
      const shown = reduceEvent(occ);
      if (!shown || shown.busy) continue;
      const sendAt = sendTimeFor(start, occ.reminderMins, occ.updatedAt ? new Date(occ.updatedAt) : null);
      if (!sendAt || sendAt < from || sendAt > to) continue;
      out.push({
        type: "EVENT",
        itemId: occ.seriesId ?? occ.id,
        title: occ.title,
        location: occ.location || null,
        start,
        sendAt,
        due: false,
        memberIds: occ.memberId ? [occ.memberId] : everyone,
      });
    }

    // Tasks - open, one-off, assigned, with a time.
    const tasks = await prisma.task.findMany({
      where: {
        status: "OPEN",
        recurrenceRule: null,
        memberId: { not: null },
        OR: [
          { scheduledFor: { gte: from, lte: horizon } },
          { scheduledFor: null, dueAt: { gte: from, lte: horizon } },
        ],
      },
    });

    for (const t of tasks) {
      const start = t.scheduledFor ?? t.dueAt;
      const sendAt = sendTimeFor(start, t.reminderMins, t.updatedAt);
      if (!sendAt || sendAt < from || sendAt > to) continue;
      out.push({
        type: "TASK",
        itemId: t.id,
        title: t.title,
        location: null,
        start,
        sendAt,
        due: !t.scheduledFor,
        memberIds: [t.memberId],
      });
    }

    return out.sort((a, b) => a.sendAt - b.sendAt);
  }

  // ------------------------------------------------------------------ wording

  /// "In 30 minutes · at 4:30 pm · Oval 3". Worked out from the real time
  /// left, so a reminder held over quiet hours does not say "in 30 minutes".
  function payloadFor(r, now) {
    const left = Math.round((r.start - now) / MIN);
    const when =
      left <= 1 ? "Now"
        : left < 60 ? `In ${left} minutes`
          : left < 120 ? "In about an hour"
            : `${dayKey(r.start) === dayKey(now) ? "Today" : "Tomorrow"}`;
    const verb = r.due ? "due" : left <= 1 ? "starting" : "at";
    const bits = [when, `${verb} ${clock(r.start)}`];
    if (r.location) bits.push(r.location);
    return {
      title: r.title,
      body: bits.join(" · "),
      url: r.type === "TASK" ? `/?task=${r.itemId}` : `/?event=${r.itemId}`,
      tag: `rem-${r.type}-${r.itemId}-${r.start.toISOString()}`,
    };
  }

  // ------------------------------------------------------------------ sending

  let running = false;

  async function tick() {
    if (running) return { skipped: "already running" };
    running = true;
    const now = new Date();
    const summary = { due: 0, sent: 0, alreadySent: 0, failed: 0 };
    try {
      const due = await plan(new Date(now.getTime() - CATCH_UP_MS), now);
      summary.due = due.length;
      for (const r of due) {
        for (const memberId of r.memberIds) {
          try {
            await prisma.reminderLog.create({
              data: { memberId, itemType: r.type, itemId: r.itemId, occursAt: r.start },
            });
          } catch (err) {
            if (err.code === "P2002") { summary.alreadySent++; continue; }
            throw err;
          }
          const res = await push.sendToMember(memberId, payloadFor(r, now));
          if (res.sent) summary.sent++; else summary.failed++;
        }
      }
      if (summary.due) console.log(JSON.stringify({ event: "reminders.tick", ...summary }));
    } catch (err) {
      console.error("reminders tick failed:", err.message);
      summary.error = err.message;
    } finally {
      running = false;
    }
    return summary;
  }

  function start() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== familyTz) {
      console.warn(`reminders: server clock is ${tz}, family is ${familyTz} - recurring events may land on the wrong day. Set TZ=${familyTz}.`);
    }
    setTimeout(tick, 20 * 1000);
    setInterval(tick, TICK_MS);
    console.log(`reminders: running every ${TICK_MS / MIN} minutes (${familyTz})`);
  }

  // ------------------------------------------------------------------- routes

  const router = Router();

  router.get("/settings", async (_req, res) => {
    res.json(await getSettings());
  });

  router.patch("/settings", async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.reminderLeadMins !== undefined) {
      const n = Number(b.reminderLeadMins);
      if (!Number.isInteger(n) || n < 0 || n > MAX_LEAD) return res.status(400).json({ error: "Lead time must be 0 to 1440 minutes" });
      data.reminderLeadMins = n;
    }
    for (const k of ["quietStart", "quietEnd"]) {
      if (b[k] !== undefined) {
        if (parseHHMM(b[k], null) === null) return res.status(400).json({ error: `${k} must be HH:MM` });
        data[k] = String(b[k]).trim().padStart(5, "0");
      }
    }
    await getSettings();
    res.json(await prisma.familySetting.update({ where: { id: 1 }, data }));
  });

  router.get("/upcoming", async (req, res) => {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
    const now = new Date();
    const items = await plan(now, new Date(now.getTime() + hours * 60 * MIN));
    const names = new Map((await prisma.familyMember.findMany()).map((m) => [m.id, m.name]));
    res.json(items.map((r) => ({
      type: r.type,
      itemId: r.itemId,
      title: r.title,
      who: r.memberIds.map((id) => names.get(id)),
      startsAt: r.start,
      sendAt: r.sendAt,
      starts: `${dayKey(r.start)} ${clock(r.start)}`,
      sends: `${dayKey(r.sendAt)} ${clock(r.sendAt)}`,
    })));
  });

  router.post("/run", async (_req, res) => {
    res.json(await tick());
  });

  return { router, start, tick, plan };
}
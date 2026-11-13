import "dotenv/config";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";
import { createJadeRouter } from "./jade.js";
import { createPush } from "./push.js";
import { createReminders, cleanReminderMins } from "./reminders.js";
import { createIdeas } from "./ideas.js";
import { reduceEvents } from "./visibility.js";

// The server works in the family's time zone, not the host's (Railway is UTC).
// Recurring events are expanded with local-time date maths, so on UTC a
// 7 am Tuesday in Adelaide would land on Monday.
process.env.TZ ||= process.env.FAMILY_TIMEZONE || "Australia/Adelaide";

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT;
const COOKIE_NAME = "family_auth";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "development-only-secret";
const APP_PASSWORD = process.env.APP_PASSWORD || "change-me";

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

if (!PROD) {
  app.use(cors({
    origin: process.env.WEB_ORIGIN || "http://localhost:5173",
    credentials: true
  }));
}

function sign(value) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
}

function validAuth(req) {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const [value, signature] = String(raw).split(".");
  if (!value || !signature) return false;
  const expected = sign(value);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && value === "family";
}

function requireAuth(req, res, next) {
  if (validAuth(req)) return next();
  res.status(401).json({ error: "Authentication required" });
}

/* Says what this server actually is, without needing the database open in
   another window. Added because a stale Prisma Client - generated before a
   column existed - looks like a working app that quietly ignores one field,
   which is a miserable thing to diagnose from the outside. */
app.get("/api/health", async (_req, res) => {
  const out = { ok: true };
  try {
    const probe = await prisma.familyMember.findFirst({
      select: { id: true, pronunciation: true }
    });
    out.schema = "current";
    out.pronunciationsSet = await prisma.familyMember.count({
      where: { NOT: { pronunciation: null } }
    });
    /* A pronunciation identical to the name is a no-op - the substitution
       skips it - and looks exactly like a working one from the outside.
       Counting them, without naming anyone on an endpoint that sits outside
       the password, is enough to tell the two apart. */
    const withSound = await prisma.familyMember.findMany({
      where: { NOT: { pronunciation: null } },
      select: { name: true, pronunciation: true }
    });
    out.sameAsName = withSound.filter(
      (m) => m.name.trim().toLowerCase() === String(m.pronunciation).trim().toLowerCase()
    ).length;
    out.members = await prisma.familyMember.count();
    void probe;
  } catch (e) {
    /* An unknown-field error here means the client was generated against an
       older schema, or the migration has not run. Either way the app will
       behave as if the column does not exist. */
    out.schema = "stale";
    out.detail = String(e.message || e).split("\n")[0].slice(0, 160);
  }
  res.json(out);
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: validAuth(req) });
});

app.post("/api/login", (req, res) => {
  const supplied = String(req.body?.password || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(APP_PASSWORD);
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!same) return res.status(401).json({ error: "Incorrect password" });

  const value = "family";
  res.cookie(COOKIE_NAME, `${value}.${sign(value)}`, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.use("/api", requireAuth);

app.get("/api/dashboard", async (_req, res) => {
  const [members, calendars, taskLists, allTasks, events, meals, shopping, notifications] = await Promise.all([
    prisma.familyMember.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.calendar.findMany({ include: { member: true }, orderBy: { id: "asc" } }),
    prisma.taskList.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.task.findMany({
      include: { member: true, list: true },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { position: "asc" }, { createdAt: "desc" }]
    }),
    prisma.event.findMany({
      include: { member: true, calendar: true },
      where: { cancelled: false },
      orderBy: { startsAt: "asc" }
    }),
    prisma.meal.findMany({ orderBy: [{ plannedFor: "asc" }, { name: "asc" }] }),
    prisma.shoppingItem.findMany({ orderBy: [{ checked: "asc" }, { position: "asc" }, { id: "asc" }] }),
    // Read state comes down with each notice so the client can work out what
    // is unread for whoever is being viewed as. There is no server-side
    // identity yet; this moves server-side when sign-in lands.
    prisma.notification.findMany({
      include: { author: true, reads: { select: { memberId: true } } },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  // Chores and routines are tasks with a different kind. The client still
  // receives them under `chores` so the Today view need not care.
  const tasks  = allTasks.filter((t) => t.kind === "TASK");
  const chores = allTasks.filter((t) => t.kind !== "TASK").map((c) => ({
    ...c, completed: c.status === "DONE", cadence: describeRecurrence(c.recurrenceRule)
  }));

  // Reduced before it ever leaves the server, so private detail never reaches
  // the browser. The rule lives in visibility.js because Jade needs the same
  // one - a second copy here is how the two drift and one of them leaks.
  const safeEvents = reduceEvents(events);

  res.json({ members, calendars, taskLists, tasks, chores, events: safeEvents, meals, shopping, notifications });
});

/// Records a notice for the family. Never throws: a failure to notify must
/// not fail the change that caused it.
async function notify({ title, body = null, kind = "CHANGE", authorId = null, entity = null, entityId = null }) {
  try {
    const notice = await prisma.notification.create({
      data: { title, body, kind, authorId, entity, entityId }
    });
    // Whoever made the change does not need telling about it. Marking it read
    // for them keeps everyone's count honest without special-casing the UI.
    if (authorId) {
      await prisma.notificationRead.create({
        data: { notificationId: notice.id, memberId: authorId }
      }).catch(() => {});
    }
    return notice;
  } catch (e) { console.error("notify failed:", e.message); return null; }
}

const FAMILY_TZ = process.env.FAMILY_TIMEZONE || "Australia/Adelaide";
const whenLabel = (d, allDay) => allDay
  ? new Intl.DateTimeFormat("en-AU", { timeZone: FAMILY_TZ, weekday: "short", day: "numeric", month: "short" }).format(d)
  : new Intl.DateTimeFormat("en-AU", { timeZone: FAMILY_TZ, weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);

/// Says what actually changed about an event, in a sentence a person would
/// write. Returns null when nothing worth telling anyone about moved.
function describeEventChange(before, after, memberName) {
  const bits = [];
  if (before.title !== after.title) bits.push(`is now called "${after.title}"`);
  if ((before.location || "") !== (after.location || ""))
    bits.push(after.location ? `moved to ${after.location}` : "no longer has a location");
  if (before.startsAt.getTime() !== after.startsAt.getTime())
    bits.push(`moved to ${whenLabel(after.startsAt, after.allDay)}`);
  else if (before.endsAt.getTime() !== after.endsAt.getTime())
    bits.push(`now finishes at ${whenLabel(after.endsAt, after.allDay)}`);
  if ((before.memberId || null) !== (after.memberId || null))
    bits.push(memberName ? `is now ${memberName}'s` : "is now a family event");
  if (!bits.length) return null;
  return `${before.title} ${bits.join(", and ")}`;
}

/// Turns an RRULE into something a person can read. Deliberately simple —
/// it covers what the seed and Microsoft To Do actually produce.
function describeRecurrence(rule) {
  if (!rule) return null;
  const freq = /FREQ=(\w+)/.exec(rule)?.[1];
  const day  = /BYDAY=(\w+)/.exec(rule)?.[1];
  const days = { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" };
  if (freq === "DAILY") return "repeats daily";
  if (freq === "WEEKLY") return day ? `repeats weekly on ${days[day] || day}` : "repeats weekly";
  if (freq === "MONTHLY") return "repeats monthly";
  return "repeats";
}

/* The only editable thing on a family member so far. Kept deliberately
   narrow: this endpoint cannot rename anyone, change a role or grant
   sign-in, because none of that should be a one-field PATCH. */
app.patch("/api/members/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown member" });
  const raw = req.body?.pronunciation;
  if (raw === undefined) return res.status(400).json({ error: "Nothing to change" });

  // An empty box means "the spelling is fine", which is null, not "".
  const value = String(raw).trim();
  const member = await prisma.familyMember.update({
    where: { id },
    data: { pronunciation: value ? value.slice(0, 60) : null }
  });
  res.json(member);
});

const ideas = createIdeas({ prisma, familyTz: FAMILY_TZ });
app.use("/api/ideas", ideas.router);
app.use("/api/jade", createJadeRouter({ prisma, notify, whenLabel, familyTz: FAMILY_TZ, ideas }));

const push = createPush({ prisma });
app.use("/api/push", push.router);

const reminders = createReminders({ prisma, push, familyTz: FAMILY_TZ });
app.use("/api/reminders", reminders.router);
reminders.start();

app.post("/api/tasks", async (req, res) => {
  const { title, notes, listId, kind, dueAt, scheduledFor, memberId, needsHelp } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "Task title is required" });

  // Quick capture sends no list, so fall back to Unallocated.
  let resolvedList = listId ? Number(listId) : null;
  if (!resolvedList) {
    const fallback = await prisma.taskList.findFirst({ where: { name: "Unallocated" } });
    resolvedList = fallback?.id ?? null;
  }

  const task = await prisma.task.create({
    data: {
      title: String(title).trim(),
      notes: notes ? String(notes) : null,
      kind: kind || "TASK",
      listId: resolvedList,
      dueAt: dueAt ? new Date(dueAt) : null,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      memberId: memberId ? Number(memberId) : null,
      reminderMins: cleanReminderMins(req.body?.reminderMins),
      needsHelp: Boolean(needsHelp)
    },
    include: { member: true, list: true }
  });
  res.status(201).json(task);
});

app.patch("/api/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const data = {};
  if ("status" in b) {
    data.status = b.status;
    data.completedAt = b.status === "DONE" ? new Date() : null;
  }
  if ("memberId" in b)     data.memberId = b.memberId ? Number(b.memberId) : null;
  if ("title" in b)        data.title = String(b.title).trim();
  if ("notes" in b)        data.notes = b.notes ? String(b.notes) : null;
  if ("listId" in b)       data.listId = b.listId ? Number(b.listId) : null;
  if ("dueAt" in b)        data.dueAt = b.dueAt ? new Date(b.dueAt) : null;
  // When it is being done, as opposed to when it is due.
  if ("scheduledFor" in b) data.scheduledFor = b.scheduledFor ? new Date(b.scheduledFor) : null;
  if ("durationMins" in b) data.durationMins = b.durationMins ? Number(b.durationMins) : null;
  if ("needsHelp" in b)    data.needsHelp = Boolean(b.needsHelp);
  if ("reminderMins" in b) data.reminderMins = cleanReminderMins(b.reminderMins);

  const before = await prisma.task.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: "No such task" });
  const task = await prisma.task.update({ where: { id }, data, include: { member: true, list: true } });

  await prisma.activityLog.create({
    data: { action: "task.update", entity: "Task", entityId: id, memberId: task.memberId }
  }).catch(() => {});

  // Scheduling something for someone is worth telling the family about;
  // ticking a task off is not.
  if ("scheduledFor" in b && task.scheduledFor && String(before.scheduledFor) !== String(task.scheduledFor)) {
    await notify({
      title: `${task.title} is scheduled for ${whenLabel(task.scheduledFor, false)}`,
      body: task.member?.name || null,
      authorId: b.actorId ? Number(b.actorId) : null,
      entity: "Task", entityId: id
    });
  }
  res.json(task);
});

/* Only a parent can delete a task. Who is acting comes from the "Viewing as"
   picker until per-person sign-in exists - the same trust as the rest. */
app.delete("/api/tasks/:id", async (req, res) => {
  const actor = req.body?.actorId
    ? await prisma.familyMember.findUnique({ where: { id: Number(req.body.actorId) } })
    : null;
  if (actor?.role !== "PARENT") return res.status(403).json({ error: "Only a parent can delete a task." });
  await prisma.task.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

app.post("/api/events", async (req, res) => {
  const { title, startsAt, endsAt, allDay, location, notes, calendarId, memberId, visibility } = req.body || {};
  if (!title || !startsAt || !endsAt) return res.status(400).json({ error: "Title, start and end are required" });

  // Every event belongs to a calendar; default to the shared family one.
  let resolvedCal = calendarId ? Number(calendarId) : null;
  if (!resolvedCal) {
    const fallback = await prisma.calendar.findFirst({ where: { name: "Family" } })
      ?? await prisma.calendar.findFirst();
    if (!fallback) return res.status(500).json({ error: "No calendar configured" });
    resolvedCal = fallback.id;
  }

  const event = await prisma.event.create({
    data: {
      calendarId: resolvedCal,
      title: String(title).trim(),
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      allDay: Boolean(allDay),
      location: location ? String(location) : null,
      notes: notes ? String(notes) : null,
      visibility: visibility || "FULL",
      recurrenceRule: req.body?.recurrenceRule || null,
      reminderMins: cleanReminderMins(req.body?.reminderMins),
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true, calendar: true }
  });
  await notify({
    title: `${event.title} was added to the calendar`,
    body: [event.member?.name, event.location].filter(Boolean).join(" · ") || null,
    authorId: req.body?.actorId ? Number(req.body.actorId) : null,
    entity: "Event", entityId: event.id
  });
  res.status(201).json(event);
});

app.patch("/api/events/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.event.findUnique({ where: { id }, include: { calendar: true } });
  if (!existing) return res.status(404).json({ error: "No such event" });

  // An event the viewer only ever sees as "Busy" must not be editable: its
  // real title never reached the browser, so a save would overwrite it with
  // the placeholder. Becomes a server-side identity check once auth is real.
  const effective = existing.visibility === "FULL"
    ? (existing.calendar?.defaultVisibility || "FULL")
    : existing.visibility;
  if (effective !== "FULL") return res.status(403).json({ error: "This one is private and cannot be edited here" });

  const b = req.body || {};
  const data = {};
  if (b.title !== undefined)      data.title = String(b.title).trim();
  if (b.location !== undefined)   data.location = b.location ? String(b.location) : null;
  if (b.notes !== undefined)      data.notes = b.notes ? String(b.notes) : null;
  if (b.startsAt !== undefined)   data.startsAt = new Date(b.startsAt);
  if (b.endsAt !== undefined)     data.endsAt = new Date(b.endsAt);
  if (b.allDay !== undefined)     data.allDay = Boolean(b.allDay);
  if (b.memberId !== undefined)   data.memberId = b.memberId ? Number(b.memberId) : null;
  if (b.calendarId !== undefined) data.calendarId = Number(b.calendarId);
  if (b.recurrenceRule !== undefined) data.recurrenceRule = b.recurrenceRule || null;
  if (b.reminderMins !== undefined) data.reminderMins = cleanReminderMins(b.reminderMins);

  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt)
    return res.status(400).json({ error: "It has to finish after it starts" });

  const event = await prisma.event.update({ where: { id }, data, include: { member: true, calendar: true } });
  await prisma.activityLog.create({
    data: { action: "event.update", entity: "Event", entityId: id, memberId: event.memberId }
  }).catch(() => {});
  const what = describeEventChange(existing, event, event.member?.name);
  if (what) await notify({
    title: what,
    body: event.location || null,
    authorId: req.body?.actorId ? Number(req.body.actorId) : null,
    entity: "Event", entityId: id
  });
  res.json(event);
});

app.delete("/api/events/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.event.findUnique({ where: { id }, include: { calendar: true } });
  if (!existing) return res.status(404).json({ error: "No such event" });
  const effective = existing.visibility === "FULL"
    ? (existing.calendar?.defaultVisibility || "FULL")
    : existing.visibility;
  if (effective !== "FULL") return res.status(403).json({ error: "This one is private and cannot be deleted here" });

  // A series parent takes its instances with it, which is what the schema's
  // onDelete: Cascade already does.
  await prisma.event.delete({ where: { id } });
  await prisma.activityLog.create({
    data: { action: "event.delete", entity: "Event", entityId: id, detail: { title: existing.title } }
  }).catch(() => {});
  await notify({
    title: `${existing.title} was removed from the calendar`,
    authorId: req.body?.actorId ? Number(req.body.actorId) : null,
    entity: "Event", entityId: id
  });
  res.json({ ok: true });
});

/// The family-readable history. Notices are written at the moment something
/// happens and never rewritten, so this is a record rather than a re-render
/// of current state. ActivityLog remains the lower-level audit trail, kept
/// for sync debugging rather than for people to read.
app.get("/api/notifications", async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 100, 300);
  const notices = await prisma.notification.findMany({
    include: { author: true, reads: { select: { memberId: true } } },
    orderBy: { createdAt: "desc" },
    take
  });
  res.json(notices);
});

app.post("/api/notifications", async (req, res) => {
  const { title, body, authorId } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "Say something" });
  const notice = await prisma.notification.create({
    data: {
      kind: "FAMILY_NOTICE",
      title: String(title).trim(),
      body: body ? String(body).trim() : null,
      authorId: authorId ? Number(authorId) : null
    },
    include: { author: true, reads: { select: { memberId: true } } }
  });
  res.status(201).json(notice);
});

/// Marks everything currently visible as read for one person.
app.post("/api/notifications/read", async (req, res) => {
  const memberId = Number(req.body?.memberId);
  if (!memberId) return res.status(400).json({ error: "Who is reading?" });
  // Specific ids when the client knows what was actually on screen, so a read
  // receipt means "this was shown to them" rather than "they tapped a bell".
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  const unread = await prisma.notification.findMany({
    where: { reads: { none: { memberId } }, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true }
  });
  if (unread.length) {
    await prisma.notificationRead.createMany({
      data: unread.map((n) => ({ notificationId: n.id, memberId })),
      skipDuplicates: true
    });
  }
  res.json({ ok: true, marked: unread.length });
});

app.post("/api/chores", async (req, res) => {
  const { title, recurrenceRule, memberId, listId } = req.body || {};
  if (!title) return res.status(400).json({ error: "Chore title is required" });
  const chore = await prisma.task.create({
    data: {
      title: String(title).trim(),
      kind: "CHORE",
      recurrenceRule: recurrenceRule || null,
      listId: listId ? Number(listId) : null,
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true }
  });
  res.status(201).json(chore);
});

app.patch("/api/chores/:id", async (req, res) => {
  const done = Boolean(req.body.completed);
  const chore = await prisma.task.update({
    where: { id: Number(req.params.id) },
    data: { status: done ? "DONE" : "OPEN", completedAt: done ? new Date() : null },
    include: { member: true }
  });
  res.json({ ...chore, completed: chore.status === "DONE" });
});

app.post("/api/meals", async (req, res) => {
  const { name, notes, plannedFor } = req.body || {};
  if (!name) return res.status(400).json({ error: "Meal name is required" });
  const meal = await prisma.meal.create({
    data: { name: String(name).trim(), notes: notes || null, plannedFor: plannedFor ? new Date(plannedFor) : null }
  });
  res.status(201).json(meal);
});

app.post("/api/shopping", async (req, res) => {
  const { name, quantity, store } = req.body || {};
  if (!name) return res.status(400).json({ error: "Item name is required" });
  const item = await prisma.shoppingItem.create({
    data: { name: String(name).trim(), quantity: quantity || null, store: store || null }
  });
  res.status(201).json(item);
});

app.patch("/api/shopping/:id", async (req, res) => {
  const item = await prisma.shoppingItem.update({
    where: { id: Number(req.params.id) },
    data: { checked: Boolean(req.body.checked) }
  });
  res.json(item);
});

if (PROD) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(PORT, () => {
  console.log(`Family Command Centre server listening on ${PORT}`);
});

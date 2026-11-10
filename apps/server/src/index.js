import "dotenv/config";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
  const [members, calendars, taskLists, allTasks, events, meals, shopping] = await Promise.all([
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
    prisma.shoppingItem.findMany({ orderBy: [{ checked: "asc" }, { position: "asc" }, { id: "asc" }] })
  ]);

  // Chores and routines are tasks with a different kind. The client still
  // receives them under `chores` so the Today view need not care.
  const tasks  = allTasks.filter((t) => t.kind === "TASK");
  const chores = allTasks.filter((t) => t.kind !== "TASK").map((c) => ({
    ...c, completed: c.status === "DONE", cadence: describeRecurrence(c.recurrenceRule)
  }));

  // An event whose calendar is BUSY-only is reduced before it ever leaves the
  // server, so private detail never reaches the browser.
  const safeEvents = events.map((e) => {
    const vis = e.visibility === "FULL" ? (e.calendar?.defaultVisibility || "FULL") : e.visibility;
    if (vis === "PRIVATE") return null;
    if (vis === "BUSY") {
      return { ...e, title: `Busy — ${e.member?.name || "Family"}`, location: null, notes: null, busy: true };
    }
    return e;
  }).filter(Boolean);

  res.json({ members, calendars, taskLists, tasks, chores, events: safeEvents, meals, shopping });
});

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

app.post("/api/tasks", async (req, res) => {
  const { title, notes, listId, kind, dueAt, scheduledFor, memberId } = req.body || {};
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
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true, list: true }
  });
  res.status(201).json(task);
});

app.patch("/api/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  const data = {};
  if ("status" in req.body) data.status = req.body.status;
  if ("memberId" in req.body) data.memberId = req.body.memberId ? Number(req.body.memberId) : null;
  if ("title" in req.body) data.title = String(req.body.title).trim();
  if ("dueAt" in req.body) data.dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
  const task = await prisma.task.update({ where: { id }, data, include: { member: true } });
  res.json(task);
});

app.delete("/api/tasks/:id", async (req, res) => {
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
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true, calendar: true }
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

  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt)
    return res.status(400).json({ error: "It has to finish after it starts" });

  const event = await prisma.event.update({ where: { id }, data, include: { member: true, calendar: true } });
  await prisma.activityLog.create({
    data: { action: "event.update", entity: "Event", entityId: id, memberId: event.memberId }
  }).catch(() => {});
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
  res.json({ ok: true });
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

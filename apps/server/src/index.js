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
const PROD = process.env.NODE_ENV === "production";
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
  const [members, tasks, events, chores, meals, shopping] = await Promise.all([
    prisma.familyMember.findMany({ orderBy: { id: "asc" } }),
    prisma.task.findMany({ include: { member: true }, orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }] }),
    prisma.event.findMany({ include: { member: true }, orderBy: { startsAt: "asc" } }),
    prisma.chore.findMany({ include: { member: true }, orderBy: [{ completed: "asc" }, { id: "asc" }] }),
    prisma.meal.findMany({ orderBy: [{ plannedFor: "asc" }, { name: "asc" }] }),
    prisma.shoppingItem.findMany({ orderBy: [{ checked: "asc" }, { id: "asc" }] })
  ]);
  res.json({ members, tasks, events, chores, meals, shopping });
});

app.post("/api/tasks", async (req, res) => {
  const { title, notes, list = "HOME", dueAt, memberId } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "Task title is required" });
  const task = await prisma.task.create({
    data: {
      title: String(title).trim(),
      notes: notes ? String(notes) : null,
      list,
      dueAt: dueAt ? new Date(dueAt) : null,
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true }
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
  const { title, startsAt, endsAt, location, notes, memberId } = req.body || {};
  if (!title || !startsAt || !endsAt) return res.status(400).json({ error: "Title, start and end are required" });
  const event = await prisma.event.create({
    data: {
      title: String(title).trim(),
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      location: location ? String(location) : null,
      notes: notes ? String(notes) : null,
      memberId: memberId ? Number(memberId) : null
    },
    include: { member: true }
  });
  res.status(201).json(event);
});

app.post("/api/chores", async (req, res) => {
  const { title, cadence, memberId } = req.body || {};
  if (!title) return res.status(400).json({ error: "Chore title is required" });
  const chore = await prisma.chore.create({
    data: { title: String(title).trim(), cadence: cadence || null, memberId: memberId ? Number(memberId) : null },
    include: { member: true }
  });
  res.status(201).json(chore);
});

app.patch("/api/chores/:id", async (req, res) => {
  const chore = await prisma.chore.update({
    where: { id: Number(req.params.id) },
    data: { completed: Boolean(req.body.completed) },
    include: { member: true }
  });
  res.json(chore);
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

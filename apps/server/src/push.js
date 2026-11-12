// Web push for the Family Command Centre.
//
// One device = one PushSubscription row, owned by one family member.
// A device registers itself from Settings -> Reminders; nothing is typed in.
//
// Routes (mounted at /api/push, behind the family sign-in):
//   GET    /public-key     VAPID public key, for the browser to subscribe with
//   POST   /subscribe      { memberId, subscription, label? } - this device is <member>'s
//   POST   /unsubscribe    { endpoint } - this device stops getting reminders
//   POST   /test           { memberId } - send a test push to that person's devices
//   GET    /devices        every registered device, for the Settings list
//   DELETE /devices/:id    remove one device from Settings
//
// Sending (used by the reminder scheduler and anything else that needs it):
//   sendToMember(memberId, payload)
//   sendToMembers([memberIds], payload)
// payload = { title, body, url, tag }
//
// Rules:
// - Sending never throws. A failed push must never break the action that
//   triggered it.
// - A 404 or 410 from the push service means the device is gone (app
//   uninstalled, permission revoked). That row is deleted automatically.
// - Every send logs one JSON line, so Railway logs show exactly what fired.

import { Router } from "express";
import webpush from "web-push";

// VAPID is configured on first use, so the server still boots (and every
// other feature still works) if the keys are missing.
let vapidReady = false;
function configureVapid() {
  if (vapidReady) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

function cleanSubscription(sub) {
  if (!sub || typeof sub !== "object") return { error: "INVALID_SUBSCRIPTION" };
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  if (!/^https:\/\//.test(endpoint)) return { error: "INVALID_ENDPOINT" };
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh.trim() : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth.trim() : "";
  if (!p256dh || !auth) return { error: "MISSING_KEYS" };
  return { endpoint, p256dh, auth };
}

export function createPush({ prisma }) {
  // ------------------------------------------------------------- sending

  async function sendToSubscriptions(subs, payload) {
    if (!subs.length) return { sent: 0, failed: 0, pruned: 0, errors: [] };
    if (!configureVapid()) {
      return {
        sent: 0,
        failed: subs.length,
        pruned: 0,
        errors: [{ status: null, body: "VAPID keys not set on server" }],
      };
    }

    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 }, // a reminder older than an hour is no use
        ),
      ),
    );

    let sent = 0;
    let failed = 0;
    const dead = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        sent++;
        return;
      }
      failed++;
      const status = r.reason?.statusCode ?? null;
      const detail = String(r.reason?.body || r.reason?.message || r.reason).slice(0, 200);
      if (status === 404 || status === 410) dead.push(subs[i].id);
      errors.push({ status, body: detail });
    });

    let pruned = 0;
    if (dead.length) {
      try {
        const res = await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
        pruned = res.count;
      } catch (err) {
        console.error("push prune failed:", err.message);
      }
    }
    return { sent, failed, pruned, errors };
  }

  async function sendToMembers(memberIds, payload) {
    const ids = [...new Set((memberIds || []).map(Number).filter(Number.isInteger))];
    try {
      const subs = ids.length
        ? await prisma.pushSubscription.findMany({ where: { memberId: { in: ids } } })
        : [];
      const result = await sendToSubscriptions(subs, payload);
      console.log(JSON.stringify({
        event: "push.send",
        members: ids,
        devices: subs.length,
        ...result,
        title: payload?.title || "",
      }));
      return result;
    } catch (err) {
      console.error("push send error:", err.message);
      return { sent: 0, failed: 0, pruned: 0, errors: [{ status: null, body: err.message }] };
    }
  }

  const sendToMember = (memberId, payload) => sendToMembers([memberId], payload);

  // -------------------------------------------------------------- routes

  const router = Router();

  router.get("/public-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(500).json({ error: "VAPID_NOT_CONFIGURED" });
    res.json({ publicKey: key });
  });

  // "This device is <member>'s." A device belongs to one person, so if the
  // same phone was registered to someone else before, that row is removed.
  router.post("/subscribe", async (req, res) => {
    const memberId = Number(req.body?.memberId);
    const sub = cleanSubscription(req.body?.subscription);
    if (sub.error) return res.status(400).json({ error: sub.error });
    const member = Number.isInteger(memberId)
      ? await prisma.familyMember.findUnique({ where: { id: memberId } })
      : null;
    if (!member) return res.status(400).json({ error: "UNKNOWN_MEMBER" });

    const label =
      typeof req.body?.label === "string" && req.body.label.trim()
        ? req.body.label.trim().slice(0, 60)
        : `${member.name}'s device`;
    const userAgent = String(req.get("user-agent") || "").slice(0, 300);

    await prisma.pushSubscription.deleteMany({
      where: { endpoint: sub.endpoint, NOT: { memberId } },
    });
    const device = await prisma.pushSubscription.upsert({
      where: { memberId_endpoint: { memberId, endpoint: sub.endpoint } },
      create: { memberId, ...sub, label, userAgent },
      update: { p256dh: sub.p256dh, auth: sub.auth, label, userAgent, lastSeenAt: new Date() },
    });
    console.log(JSON.stringify({ event: "push.subscribe", member: member.name, deviceId: device.id }));
    res.json({ ok: true, deviceId: device.id, memberId, label });
  });

  // Idempotent: succeeds even if the row is already gone.
  router.post("/unsubscribe", async (req, res) => {
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    if (!endpoint) return res.status(400).json({ error: "INVALID_ENDPOINT" });
    const { count } = await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    res.json({ ok: true, removed: count });
  });

  // Returns the provider's own errors, so a failed test says why.
  router.post("/test", async (req, res) => {
    const memberId = Number(req.body?.memberId);
    const member = Number.isInteger(memberId)
      ? await prisma.familyMember.findUnique({ where: { id: memberId } })
      : null;
    if (!member) return res.status(400).json({ error: "UNKNOWN_MEMBER" });
    const result = await sendToMember(memberId, {
      title: "Test reminder 🔔",
      body: `If you can see this, reminders work on ${member.name}'s device.`,
      url: "/",
      tag: "push-test",
    });
    res.json({ ok: true, ...result, devices: result.sent + result.failed });
  });

  // For the Settings list. Never returns the encryption keys.
  router.get("/devices", async (_req, res) => {
    const devices = await prisma.pushSubscription.findMany({
      select: {
        id: true,
        memberId: true,
        label: true,
        userAgent: true,
        endpoint: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: [{ memberId: "asc" }, { createdAt: "asc" }],
    });
    res.json(devices);
  });

  router.delete("/devices/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "INVALID_ID" });
    const { count } = await prisma.pushSubscription.deleteMany({ where: { id } });
    res.json({ ok: true, removed: count });
  });

  return { router, sendToMember, sendToMembers };
}
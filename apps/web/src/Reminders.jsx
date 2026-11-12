import React, { useEffect, useState } from "react";

/* Reminders: push notifications to the installed app.

   A device registers itself - "this phone is Jack's" - so nothing is typed
   in. On a phone this card is the whole of Settings; on a desktop it also
   lists every family device with Test and Remove, so it is obvious at a
   glance who can actually be reminded.

   Two platform rules shape the code:
   - The permission prompt must come straight from a tap. Ask first, then
     do the slower work (fetch the key, subscribe), or iOS ignores it.
   - On iPhone, push only exists once the app is added to the home screen. */

const b64ToBytes = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

function support() {
  if (isIOS() && !isInstalled()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

/* navigator.serviceWorker.ready never settles if no worker is registered
   (the dev server never registers one), so give up after a few seconds. */
const workerReady = () =>
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("The app's service worker is not running. Reload and try again.")), 5000)),
  ]);

async function currentSubscription() {
  try {
    const reg = await workerReady();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

const deviceKind = () =>
  /iphone/i.test(navigator.userAgent) ? "iPhone"
    : /ipad/i.test(navigator.userAgent) ? "iPad"
      : /android/i.test(navigator.userAgent) ? "phone"
        : "computer";

const shortAgent = (ua = "") =>
  /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android"
    : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : "Browser";

const dateOnly = (iso) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(iso));

export default function Reminders({ api, members, viewer, showAll = false }) {
  const [state, setState] = useState(() => support());
  const [endpoint, setEndpoint] = useState(null);
  const [devices, setDevices] = useState([]);
  const [owner, setOwner] = useState(() => viewer?.id ?? members[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadDevices = async () => {
    try { setDevices(await api("/api/push/devices")); } catch { /* list is a nicety */ }
  };

  useEffect(() => {
    currentSubscription().then((s) => setEndpoint(s?.endpoint || null));
    loadDevices();
  }, []);

  useEffect(() => {
    if (owner === "" && viewer?.id) setOwner(viewer.id);
  }, [viewer]);

  const mine = devices.find((d) => d.endpoint === endpoint) || null;
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "Someone";

  const run = async (fn) => {
    setBusy(true);
    setMessage("");
    try { await fn(); } catch (err) { setMessage(err.message || String(err)); }
    setBusy(false);
  };

  const turnOn = () => run(async () => {
    // Permission first, while we are still inside the tap.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(support());
      throw new Error(permission === "denied"
        ? "Notifications are blocked for this app. Allow them in the device settings, then try again."
        : "Notifications were not allowed.");
    }
    const reg = await workerReady();
    const { publicKey } = await api("/api/push/public-key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    const memberId = Number(owner);
    await api("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ memberId, label: `${nameOf(memberId)}'s ${deviceKind()}`, subscription: sub.toJSON() }),
    });
    setEndpoint(sub.endpoint);
    await loadDevices();
    setMessage("Reminders are on. Tap Send test to check.");
  });

  const turnOff = () => run(async () => {
    const sub = await currentSubscription();
    if (sub) {
      await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe().catch(() => {});
    }
    setEndpoint(null);
    await loadDevices();
    setMessage("Reminders are off on this device.");
  });

  const test = (memberId) => run(async () => {
    const r = await api("/api/push/test", { method: "POST", body: JSON.stringify({ memberId }) });
    if (!r.devices) throw new Error(`${nameOf(memberId)} has no devices with reminders on.`);
    if (r.failed) {
      const why = r.errors?.[0]?.body ? ` (${r.errors[0].body})` : "";
      throw new Error(`Sent to ${r.sent} of ${r.devices} device${r.devices === 1 ? "" : "s"}${why}`);
    }
    setMessage(`Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.`);
  });

  const remove = (id) => run(async () => {
    await api(`/api/push/devices/${id}`, { method: "DELETE" });
    if (devices.find((d) => d.id === id)?.endpoint === endpoint) {
      const sub = await currentSubscription();
      await sub?.unsubscribe().catch(() => {});
      setEndpoint(null);
    }
    await loadDevices();
  });

  return (
    <section className="agenda-card">
      <div className="section-title"><h2>Reminders</h2></div>

      {/* ---- this device ---- */}
      <div className="connection-list" style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <div className="connection-row">
          <span className="connection-icon">🔔</span>
          <div>
            <strong>This {deviceKind()}</strong>
            <small>
              {state === "ios-install" && "On iPhone, reminders only work once the app is on your home screen. Tap Share, then Add to Home Screen, and open it from there."}
              {state === "unsupported" && "This browser cannot receive reminders."}
              {state === "denied" && "Notifications are blocked for this app. Allow them in the device settings, then reload."}
              {state === "ok" && (mine
                ? `Reminders go to ${nameOf(mine.memberId)}.`
                : "Reminders are off on this device.")}
            </small>
          </div>
          <span className={`connection-state ${mine ? "connected" : "off"}`}>{mine ? "On" : "Off"}</span>
        </div>
      </div>

      {state === "ok" && !mine && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 14 }}>
          <label style={{ fontWeight: 700 }}>
            Whose {deviceKind()} is this?{" "}
            <select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={busy}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="button" className="chip-button" onClick={turnOn} disabled={busy || owner === ""}>
            {busy ? "Turning on…" : "Turn on reminders"}
          </button>
        </div>
      )}

      {state === "ok" && mine && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <button type="button" className="chip-button" onClick={() => test(mine.memberId)} disabled={busy}>Send test</button>
          <button type="button" className="chip-button" onClick={turnOff} disabled={busy}>Turn off</button>
        </div>
      )}

      {message && <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14 }}>{message}</p>}

      {/* ---- every device, desktop only ---- */}
      {showAll && (
        <div style={{ marginTop: 22 }}>
          <p className="eyebrow">WHO CAN BE REMINDED</p>
          <div className="connection-list" style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {members.map((m) => {
              const theirs = devices.filter((d) => d.memberId === m.id);
              return (
                <div className="connection-row" key={m.id}>
                  <span className="connection-icon">{m.initials}</span>
                  <div>
                    <strong>{m.name}</strong>
                    {theirs.length === 0 && <small>No devices yet</small>}
                    {theirs.map((d) => (
                      <small key={d.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {d.label} · {shortAgent(d.userAgent)} · added {dateOnly(d.createdAt)}
                        {d.endpoint === endpoint && " · this device"}
                        <button type="button" className="chip-button" onClick={() => remove(d.id)} disabled={busy}>Remove</button>
                      </small>
                    ))}
                  </div>
                  {theirs.length > 0
                    ? <button type="button" className="chip-button" onClick={() => test(m.id)} disabled={busy}>Test</button>
                    : <span className="connection-state off">Off</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
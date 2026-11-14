import React, { useState } from "react";
import { CHECK_AISLE } from "./MealPlan.jsx";

/* The shopping list, the way Rhian shops: by store, then in the order you
   walk the aisles. Each product remembers its usual store - pick ALDI for
   dog food once and it goes there next time. "Check you have" (staples
   from the meal plan) sits at the bottom: tap Need it to move one onto the
   list. */

const STORES = ["ALDI", "Coles", "Drakes", "Costco"];
const AISLES = ["Produce", "Meat", "Seafood", "Dairy", "Bakery", "Pantry", "Frozen", "Household"];
const ANY = "Any store";
const LAST_STORE = "fcc-last-store";
const recallStore = () => { try { return localStorage.getItem(LAST_STORE) || ""; } catch { return ""; } };
const saveStore = (s) => { try { localStorage.setItem(LAST_STORE, s); } catch { /* fine */ } };

export default function Shopping({ api, items, viewer, onChange, onSync }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [synced, setSynced] = useState("");
  const [name, setName] = useState("");
  const [store, setStore] = useState(recallStore);   // "" = wherever we usually get it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn) => {
    setBusy(true); setError("");
    try { await fn(); await onChange(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const add = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    run(() => api("/api/shopping", { method: "POST", body: JSON.stringify({ name: n, store: store || undefined, actorId: viewer?.id }) }));
    setName("");
  };
  const patch = (i, body) => run(() => api(`/api/shopping/${i.id}`, { method: "PATCH", body: JSON.stringify(body) }));
  const drop = (i) => run(() => api(`/api/shopping/${i.id}`, { method: "DELETE" }));
  const clearTicked = () => run(() => api("/api/shopping/checked", { method: "DELETE" }));
  const clearAll = () => { setConfirmClear(false); run(() => api("/api/shopping", { method: "DELETE" })); };
  const update = () => run(async () => {
    const r = await onSync?.();
    setSynced(!r?.active ? "No list from the dinners yet - make one from the Plan tab."
      : r.removed || r.updated || r.ask?.length ? `Updated: ${r.removed} removed, ${r.updated} changed${r.ask?.length ? `, ${r.ask.length} to check` : ""}.` : "Already up to date with the dinners.");
    setTimeout(() => setSynced(""), 6000);
  });

  const real = items.filter((i) => i.aisle !== CHECK_AISLE);
  const check = items.filter((i) => i.aisle === CHECK_AISLE && !i.checked);
  const left = real.filter((i) => !i.checked);
  const ticked = real.filter((i) => i.checked);

  const storeOf = (i) => i.store || ANY;
  const extra = [...new Set(left.map(storeOf))].filter((s) => s !== ANY && !STORES.includes(s));
  const groups = [...STORES, ...extra, ANY]
    .map((s) => [s, left.filter((i) => storeOf(i) === s)])
    .filter(([, list]) => list.length);
  const byAisle = (list) => [...AISLES, null]
    .map((a) => [a, list.filter((i) => (AISLES.includes(i.aisle) ? i.aisle : null) === a)])
    .filter(([, l]) => l.length);

  const storePick = (i) => (
    <select value={i.store || ""} onChange={(e) => patch(i, { store: e.target.value || null })} disabled={busy}
      aria-label="Store" onClick={(e) => e.stopPropagation()}
      style={{ border: "1px solid var(--line)", borderRadius: 999, padding: "2px 6px", fontSize: 12, color: "var(--muted)", background: "#fff", maxWidth: 92 }}>
      <option value="">Any</option>
      {[...STORES, ...(i.store && !STORES.includes(i.store) ? [i.store] : [])].map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );

  const row = (i) => (
    <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <button type="button" onClick={() => patch(i, { checked: !i.checked })} disabled={busy} aria-label={i.checked ? "Untick" : "Tick"}
        className="task-check" style={{ cursor: "pointer", flex: "0 0 auto", ...(i.checked ? { background: "#7fbf8a", borderColor: "#7fbf8a", color: "#fff" } : {}) }}>
        {i.checked ? "✓" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0 }} onClick={() => patch(i, { checked: !i.checked })}>
        <strong style={i.checked ? { color: "#98a0ad", textDecoration: "line-through" } : undefined}>
          {i.name}{i.quantity ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {i.quantity}</span> : ""}
        </strong>
        {i.note && <div style={{ fontSize: 12, color: "#98a0ad", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.note}</div>}
      </div>
      {!i.checked && storePick(i)}
      <button type="button" onClick={() => drop(i)} disabled={busy} aria-label="Remove"
        style={{ border: 0, background: "none", color: "#98a0ad", fontSize: 18, cursor: "pointer" }}>×</button>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 720 }}>
      <section className="task-card">
        <div className="section-title"><h2>Shopping list</h2><span className="count-badge">{left.length}</span></div>
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add something - e.g. milk" style={{ flex: 1, minWidth: 0 }} />
          <select value={store} onChange={(e) => { setStore(e.target.value); saveStore(e.target.value); }} aria-label="Store" style={{ maxWidth: 110 }}>
            <option value="">Usual store</option>
            {STORES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="submit" className="calendar-add-item" disabled={busy || !name.trim()}>Add</button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          {onSync && <button type="button" className="chip-button" onClick={update} disabled={busy}>↻ Update from dinners</button>}
          <span style={{ flex: 1 }} />
          {items.length > 0 && (confirmClear ? (
            <>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Empty the whole list?</span>
              <button type="button" className="danger-button" onClick={clearAll} disabled={busy}>Yes, clear it</button>
              <button type="button" className="chip-button" onClick={() => setConfirmClear(false)}>No</button>
            </>
          ) : <button type="button" className="danger-ghost" onClick={() => setConfirmClear(true)} disabled={busy}>Clear list</button>)}
        </div>
        {synced && <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0" }}>{synced}</p>}
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}

        {groups.map(([s, list]) => (
          <div key={s} style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, borderBottom: "2px solid var(--navy)", paddingBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, flex: 1 }}>{s}</h3>
              <span style={{ fontSize: 13, fontWeight: 800, color: "var(--muted)" }}>{list.length}</span>
            </div>
            {byAisle(list).map(([a, l]) => (
              <div key={a || "other"}>
                <p className="eyebrow" style={{ margin: "10px 0 0" }}>{(a || "Other").toUpperCase()}</p>
                {l.map(row)}
              </div>
            ))}
          </div>
        ))}
        {!left.length && <p style={{ color: "var(--muted)", marginTop: 14 }}>Nothing left to buy. Plan the dinners, then tap <strong>Shopping list</strong> on the Plan tab.</p>}

        {ticked.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p className="eyebrow">IN THE TROLLEY · {ticked.length}</p>
              <button type="button" className="chip-button" onClick={clearTicked} disabled={busy}>Clear ticked</button>
            </div>
            {ticked.map(row)}
          </div>
        )}
      </section>

      {check.length > 0 && (
        <section className="task-card">
          <div className="section-title"><h2>Check you have</h2><span className="count-badge">{check.length}</span></div>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "6px 0 10px" }}>The dinners use these. Tap <strong>Need it</strong> to put one on the list, or × if you've got it.</p>
          {check.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{i.name}</strong>{i.quantity && <span style={{ color: "var(--muted)" }}> · {i.quantity}</span>}
                {i.note && <div style={{ fontSize: 12, color: "#98a0ad" }}>{i.note}</div>}
              </div>
              <button type="button" className="chip-button" onClick={() => patch(i, { aisle: "Pantry" })} disabled={busy}>Need it</button>
              <button type="button" onClick={() => drop(i)} disabled={busy} aria-label="Got it"
                style={{ border: 0, background: "none", color: "#98a0ad", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { CHECK_AISLE } from "./MealPlan.jsx";

/* The shopping list, in the order you walk the shop. "Check you have"
   (staples from the meal plan) sits at the bottom: tap one to move it
   into the real list. */

const AISLES = ["Produce", "Meat", "Seafood", "Dairy", "Bakery", "Pantry", "Frozen"];
const OTHER = "Other";

export default function Shopping({ api, items, viewer, onChange }) {
  const [name, setName] = useState("");
  const [aisle, setAisle] = useState("");
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
    run(() => api("/api/shopping", { method: "POST", body: JSON.stringify({ name: n, aisle: aisle || null, actorId: viewer?.id }) }));
    setName("");
  };
  const toggle = (i) => run(() => api(`/api/shopping/${i.id}`, { method: "PATCH", body: JSON.stringify({ checked: !i.checked }) }));
  const need = (i) => run(() => api(`/api/shopping/${i.id}`, { method: "PATCH", body: JSON.stringify({ aisle: "Pantry" }) }));
  const drop = (i) => run(() => api(`/api/shopping/${i.id}`, { method: "DELETE" }));
  const clearTicked = () => run(() => api("/api/shopping/checked", { method: "DELETE" }));

  const real = items.filter((i) => i.aisle !== CHECK_AISLE);
  const check = items.filter((i) => i.aisle === CHECK_AISLE && !i.checked);
  const left = real.filter((i) => !i.checked);
  const ticked = real.filter((i) => i.checked);
  const groups = [...AISLES, OTHER]
    .map((a) => [a, left.filter((i) => (AISLES.includes(i.aisle) ? i.aisle : OTHER) === a)])
    .filter(([, list]) => list.length);

  const row = (i) => (
    <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <button type="button" onClick={() => toggle(i)} disabled={busy} aria-label={i.checked ? "Untick" : "Tick"}
        className="task-check" style={{ cursor: "pointer", flex: "0 0 auto", ...(i.checked ? { background: "#7fbf8a", borderColor: "#7fbf8a", color: "#fff" } : {}) }}>
        {i.checked ? "✓" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0 }} onClick={() => toggle(i)}>
        <strong style={i.checked ? { color: "#98a0ad", textDecoration: "line-through" } : undefined}>
          {i.name}{i.quantity ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {i.quantity}</span> : ""}
        </strong>
        {(i.note || i.store) && <div style={{ fontSize: 12, color: "#98a0ad" }}>{[i.note, i.store].filter(Boolean).join(" · ")}</div>}
      </div>
      <button type="button" onClick={() => drop(i)} disabled={busy} aria-label="Remove"
        style={{ border: 0, background: "none", color: "#98a0ad", fontSize: 18, cursor: "pointer" }}>×</button>
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 720 }}>
      <section className="task-card">
        <div className="section-title"><h2>Shopping list</h2><span className="count-badge">{left.length}</span></div>
        <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add something - e.g. milk" style={{ flex: "1 1 200px", minWidth: 0 }} />
          <select value={aisle} onChange={(e) => setAisle(e.target.value)} aria-label="Aisle">
            <option value="">Aisle…</option>
            {AISLES.map((a) => <option key={a}>{a}</option>)}
          </select>
          <button type="submit" className="calendar-add-item" disabled={busy || !name.trim()}>Add</button>
        </form>
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}

        {groups.map(([a, list]) => (
          <div key={a} style={{ marginTop: 14 }}>
            <p className="eyebrow">{a.toUpperCase()}</p>
            {list.map(row)}
          </div>
        ))}
        {!left.length && <p style={{ color: "var(--muted)", marginTop: 14 }}>Nothing left to buy. Plan the week's dinners in Recipes and tap <strong>Make shopping list</strong>.</p>}

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
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "6px 0 10px" }}>The week's dinners use these. Tap <strong>Need it</strong> to put one on the list, or × if you've got it.</p>
          {check.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{i.name}</strong>{i.quantity && <span style={{ color: "var(--muted)" }}> · {i.quantity}</span>}
                {i.note && <div style={{ fontSize: 12, color: "#98a0ad" }}>{i.note}</div>}
              </div>
              <button type="button" className="chip-button" onClick={() => need(i)} disabled={busy}>Need it</button>
              <button type="button" onClick={() => drop(i)} disabled={busy} aria-label="Got it"
                style={{ border: 0, background: "none", color: "#98a0ad", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

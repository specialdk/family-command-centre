import React, { useEffect, useState } from "react";

/* The week's dinners, at the top of Recipes.

   - Desktop: drag a recipe card onto a night.
   - Phone: open a recipe and tap a night, or tap a night and then a recipe.
   - "Plan my week" fills the empty nights from the family's favourites.
   - "Make shopping list" adds the ingredients up, asks what's already in
     the cupboard, and puts the rest on the list. Staples (salt, oil,
     garlic...) go into their own "Check you have" group. */

export const CHECK_AISLE = "Check you have";
const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const mondayOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return dayKey(x); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export const dayName = (k, long) => new Intl.DateTimeFormat("en-AU", { weekday: long ? "long" : "short" }).format(fromKey(k));
const dayNum = (k) => fromKey(k).getDate();
const monthOf = (k) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(fromKey(k));

const readGf = () => { try { return localStorage.getItem("fcc-plan-gf") === "1"; } catch { return false; } };
const saveGf = (v) => { try { localStorage.setItem("fcc-plan-gf", v ? "1" : "0"); } catch { /* fine */ } };

export function useWeekPlan(api) {
  const [start, setStart] = useState(() => mondayOf());
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState("");
  const load = () => api(`/api/plan?start=${start}`).then((r) => setMeals(r.meals)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [start]);
  const run = async (fn) => { setError(""); try { await fn(); } catch (e) { setError(e.message); } await load(); };
  return {
    start, setStart, meals, error, setError, reload: load,
    byDay: Object.fromEntries(meals.map((m) => [m.day, m])),
    put: (recipeId, date) => run(() => api("/api/plan", { method: "POST", body: JSON.stringify({ recipeId, date }) })),
    remove: (meal) => run(() => api(`/api/plan/${meal.id}`, { method: "DELETE" })),
    fill: (glutenFree) => run(async () => {
      const r = await api("/api/plan/fill", { method: "POST", body: JSON.stringify({ start, glutenFree }) });
      if (r.short) setError(`Filled ${r.added} night${r.added === 1 ? "" : "s"} - ran out of recipes that haven't been had in the last fortnight.`);
    }),
  };
}

function Thumb({ recipe, size }) {
  const box = { width: "100%", height: size, borderRadius: 8, overflow: "hidden", background: "linear-gradient(135deg, #fff4e6, #eef6ff)", display: "grid", placeItems: "center", fontSize: 22 };
  return <div style={box}>{recipe?.imageAt
    ? <img src={`/api/recipes/${recipe.id}/image?v=${encodeURIComponent(recipe.imageAt)}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    : <span aria-hidden="true">🍽️</span>}</div>;
}

export function WeekStrip({ plan, onDay, choosing, onMakeList }) {
  const [gf, setGf] = useState(readGf);
  const [over, setOver] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const days = weekDays(plan.start);
  const empty = days.filter((d) => !plan.byDay[d]).length;

  const drop = (e, d) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData("text/recipe-id") || e.dataTransfer.getData("text/plain"));
    if (id) plan.put(id, d);
  };
  const fill = async () => { setBusy(true); await plan.fill(gf); setBusy(false); };

  return (
    <section className="agenda-card">
      <div className="section-title" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>Dinners this week</h2>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="chip-button" onClick={() => plan.setStart(addDays(plan.start, -7))} aria-label="Previous week">‹</button>
          <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 110, textAlign: "center" }}>{monthOf(days[0])} – {monthOf(days[6])}</span>
          <button type="button" className="chip-button" onClick={() => plan.setStart(addDays(plan.start, 7))} aria-label="Next week">›</button>
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(84px, 1fr))", gap: 8, marginTop: 12, overflowX: "auto", paddingBottom: 4 }}>
        {days.map((d) => {
          const m = plan.byDay[d];
          const isChoosing = choosing === d;
          return (
            <button key={d} type="button" onClick={() => onDay(d, m)}
              onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, d)}
              style={{ font: "inherit", textAlign: "left", cursor: "pointer", padding: 6, borderRadius: 12, display: "grid", gap: 5, alignContent: "start", minHeight: 122,
                       background: over === d || isChoosing ? "#eef6ff" : "#fff", color: "var(--ink)",
                       border: `${isChoosing || over === d ? 2 : 1}px ${m ? "solid" : "dashed"} ${isChoosing || over === d ? "var(--navy)" : d === today ? "var(--coral)" : "var(--line)"}` }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: d === today ? "var(--coral)" : "var(--muted)" }}>{dayName(d)} {dayNum(d)}</span>
              {m ? (
                <>
                  <Thumb recipe={m.recipe} size={56} />
                  <span style={{ fontSize: 12, lineHeight: 1.25, fontWeight: 700 }}>{m.name}</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "#98a0ad", alignSelf: "center", textAlign: "center", paddingTop: 22 }}>{isChoosing ? "Now tap a recipe ↓" : "+ Add"}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button type="button" className="calendar-add-item" onClick={fill} disabled={busy || !empty}>
          {busy ? "Planning…" : empty ? `✨ Plan my week (${empty} night${empty === 1 ? "" : "s"})` : "✨ Week's planned"}
        </button>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={gf} onChange={(e) => { setGf(e.target.checked); saveGf(e.target.checked); }} /> Gluten free only
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" className="chip-button" onClick={onMakeList} disabled={!plan.meals.length}>🛒 Make shopping list</button>
      </div>
      <p style={{ fontSize: 12, color: "#98a0ad", margin: "8px 0 0" }}>Drag a recipe onto a night, or tap a night and then a recipe. Favourites come first; nothing repeats within a fortnight.</p>
      {plan.error && <div className="alert" style={{ marginTop: 10 }}>{plan.error}</div>}
    </section>
  );
}

/* Tapping a night that already has a dinner. */
export function DaySheet({ day, meal, onSwap, onRemove, onOpen, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">{dayName(day, true).toUpperCase()} DINNER</p>
        <h2>{meal.name}</h2>
        <div className="sheet-actions" style={{ marginTop: 16, flexWrap: "wrap" }}>
          {meal.recipeId && <button type="button" className="chip-button" onClick={onOpen}>Open recipe</button>}
          <button type="button" className="chip-button" onClick={onSwap}>🔄 Swap it</button>
          <button type="button" className="danger-ghost" onClick={onRemove}>Remove</button>
          <button type="button" className="chip-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* Row of nights inside a recipe - the phone way to plan. */
export function PlanButtons({ plan, recipeId, onDone }) {
  return (
    <div style={{ marginTop: 14 }}>
      <p className="eyebrow">ADD TO DINNERS</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {weekDays(plan.start).map((d) => {
          const m = plan.byDay[d];
          const here = m?.recipeId === recipeId;
          return (
            <button key={d} type="button" className="chip-button" disabled={here}
              title={m && !here ? `Replaces ${m.name}` : undefined}
              onClick={async () => { await plan.put(recipeId, d); onDone?.(d); }}
              style={here ? { background: "var(--mint)", fontWeight: 800 } : m ? { opacity: 0.7 } : undefined}>
              {here ? "✓ " : ""}{dayName(d)}{m && !here ? " •" : ""}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "#98a0ad", margin: "6px 0 0" }}>A dot means that night already has a dinner - tapping it swaps.</p>
    </div>
  );
}

/* Check the cupboard, then add what's needed to the shopping list. */
export function CupboardCheck({ api, plan, viewer, onClose, onAdded }) {
  const [list, setList] = useState(null);
  const [got, setGot] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api("/api/plan/shopping", { method: "POST", body: JSON.stringify({ start: plan.start }) }), api("/api/dashboard")])
      .then(([l, dash]) => {
        const already = new Set((dash.shopping || []).filter((i) => !i.checked).map((i) => i.name.toLowerCase()));
        setList({ ...l, buy: l.buy.filter((x) => !already.has(x.name.toLowerCase())), staples: l.staples.filter((x) => !already.has(x.name.toLowerCase())), onList: already.size });
      })
      .catch((e) => setError(e.message));
  }, []);

  const add = async () => {
    setBusy(true); setError("");
    try {
      const items = [
        ...list.buy.filter((x) => !got[x.name]),
        ...list.staples.map((x) => ({ ...x, aisle: CHECK_AISLE })),
      ];
      await api("/api/shopping/bulk", { method: "POST", body: JSON.stringify({ items, actorId: viewer?.id }) });
      onAdded?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const need = list ? list.buy.filter((x) => !got[x.name]).length : 0;
  let lastAisle = null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <p className="eyebrow">CHECK THE CUPBOARD</p>
        <h2>What have we already got?</h2>
        {!list ? <p style={{ color: "var(--muted)" }}>{error || "Adding up the week…"}</p> : (
          <>
            <p className="sheet-note" style={{ marginTop: 4 }}>
              {list.dinners} dinner{list.dinners === 1 ? "" : "s"}. Tap <strong>Got it</strong> for anything that's already in the house.
            </p>
            <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
              {list.buy.map((x) => {
                const head = x.aisle !== lastAisle ? (lastAisle = x.aisle) : null;
                const have = !!got[x.name];
                return (
                  <React.Fragment key={x.name}>
                    {head && <p className="eyebrow" style={{ margin: "10px 0 2px" }}>{head.toUpperCase()}</p>}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ flex: 1, minWidth: 0, opacity: have ? 0.45 : 1 }}>
                        <strong style={{ textDecoration: have ? "line-through" : "none" }}>{x.name}</strong>
                        {x.qty && <span style={{ color: "var(--muted)" }}> · {x.qty}</span>}
                        <div style={{ fontSize: 12, color: "#98a0ad" }}>{x.for.join(", ")}</div>
                      </div>
                      <button type="button" className="chip-button" onClick={() => setGot((g) => ({ ...g, [x.name]: !have }))}
                        style={have ? { background: "var(--mint)", fontWeight: 800 } : undefined}>{have ? "✓ Got it" : "Got it"}</button>
                    </div>
                  </React.Fragment>
                );
              })}
              {!list.buy.length && <p style={{ color: "var(--muted)" }}>Everything's already on the list.</p>}
            </div>
            {list.staples.length > 0 && (
              <>
                <p className="eyebrow" style={{ marginTop: 16 }}>CHECK YOU HAVE</p>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
                  {list.staples.map((x) => x.name).join(", ")}. These go in their own group at the bottom of the list - tap one there if you need to buy it.
                </p>
              </>
            )}
            {list.onList > 0 && <p style={{ fontSize: 12, color: "#98a0ad" }}>Things already on the shopping list aren't asked about again.</p>}
            {error && <div className="alert">{error}</div>}
            <div className="sheet-actions" style={{ marginTop: 16 }}>
              <button type="button" className="chip-button" onClick={onClose}>Cancel</button>
              <button type="button" className="calendar-add-item" onClick={add} disabled={busy}>
                {busy ? "Adding…" : `Add ${need} to the list`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

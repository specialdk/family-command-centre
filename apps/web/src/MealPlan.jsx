import React, { useEffect, useState } from "react";
import { usePhone } from "./PhoneHome.jsx";

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

export function useWeekPlan(api, { onSynced } = {}) {
  const [ask, setAsk] = useState(null);   // a new dinner's ingredients, waiting for a quick cupboard check
  const [start, setStart] = useState(() => dayKey(new Date()));   // from tonight: past nights are not shown
  const [meals, setMeals] = useState([]);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  /* A phone often opens the app mid-way between wifi and 4G, or just as a
     deploy restarts the server, so a first fetch can fail. Try again a
     couple of times quietly before saying anything, and re-read whenever
     the app comes back into view. */
  const load = async (tries = 3) => {
    for (let i = 0; i < tries; i++) {
      try {
        const [r, w] = await Promise.all([api(`/api/plan?start=${start}`), api("/api/plan/requests")]);
        setMeals(r.meals); setRequests(w); setError("");
        return;
      } catch (e) {
        if (i === tries - 1) setError("Couldn't load the dinners just now - pull down or come back in a moment.");
        else await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
      }
    }
  };
  useEffect(() => { load(); }, [start]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") load(2); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [start]);
  /* After any change to the dinners, bring the shopping list into step. */
  const sync = async () => {
    try {
      const r = await api("/api/plan/sync", { method: "POST" });
      if (!r.active) return r;
      if (r.ask?.length) setAsk(r.ask);
      if (r.removed || r.updated) onSynced?.();
      return r;
    } catch { return null; }
  };
  const run = async (fn) => { setError(""); try { await fn(); } catch (e) { setError(e.message); } await load(); await sync(); };
  return {
    start, setStart, meals, requests, error, setError, reload: load,
    newItems: ask, clearNewItems: () => setAsk(null), sync,
    ask: (recipeId, memberId) => run(() => api("/api/plan/requests", { method: "POST", body: JSON.stringify({ recipeId, memberId }) })),
    dismiss: (req) => run(() => api(`/api/plan/requests/${req.id}`, { method: "DELETE" })),
    byDay: Object.fromEntries(meals.map((m) => [m.day, m])),
    put: (recipeId, date) => run(() => api("/api/plan", { method: "POST", body: JSON.stringify({ recipeId, date }) })),
    remove: (meal) => run(() => api(`/api/plan/${meal.id}`, { method: "DELETE" })),
    fill: (glutenFree) => run(async () => {
      const r = await api("/api/plan/fill", { method: "POST", body: JSON.stringify({ start, glutenFree }) });
      if (r.wished) setError("");
      if (r.short) setError(`Filled ${r.added} night${r.added === 1 ? "" : "s"} - ran out of recipes that haven't been had in the last fortnight.`);
    }),
  };
}

function Thumb({ recipe, fill }) {
  const box = { width: "100%", ...(fill ? { height: "100%" } : { aspectRatio: "4 / 3" }), borderRadius: fill ? 0 : 8, overflow: "hidden", background: "linear-gradient(135deg, #ffe3c4, #ffd6dc 55%, #dcecff)", display: "grid", placeItems: "center", fontSize: fill ? 14 : 22 };
  return <div style={box}>{recipe?.imageAt
    ? <img src={`/api/recipes/${recipe.id}/image?v=${encodeURIComponent(recipe.imageAt)}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    : <span aria-hidden="true">🍽️</span>}</div>;
}

/* The kids' "can we have...?" list. Drag one onto a night, or tap to open it. */
function WishList({ plan, viewer, onOpen }) {
  if (!plan.requests.length) return null;
  const isParent = viewer?.role === "PARENT";
  return (
    <div style={{ marginTop: 12 }}>
      <p className="eyebrow">🙋 WISH LIST · PLAN MY WEEK PUTS THESE FIRST</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {plan.requests.map((w) => (
          <span key={w.id} draggable={!!w.recipeId}
            onDragStart={(e) => { e.dataTransfer.setData("text/recipe-id", String(w.recipeId)); e.dataTransfer.setData("text/plain", String(w.recipeId)); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 6px 4px 4px", borderRadius: 999, border: "1px solid var(--line)", background: "#fffaf0", cursor: w.recipeId ? "grab" : "default" }}>
            <span style={{ width: 30, height: 30, borderRadius: 999, overflow: "hidden", flex: "0 0 auto" }}><Thumb recipe={w.recipe} fill /></span>
            <button type="button" onClick={() => w.recipeId && onOpen(w.recipeId)} style={{ border: 0, background: "none", font: "inherit", cursor: "pointer", padding: 0, textAlign: "left" }}>
              <strong style={{ fontSize: 13 }}>{w.title}</strong>
              <span style={{ fontSize: 12, color: "var(--muted)" }}> · {w.member?.name || "someone"}{w.recipeId ? "" : " · not in the book"}</span>
            </button>
            {(isParent || w.member?.id === viewer?.id) && (
              <button type="button" onClick={() => plan.dismiss(w)} aria-label="Remove from wish list"
                style={{ border: 0, background: "none", color: "#98a0ad", fontSize: 16, cursor: "pointer" }}>×</button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

const nightLabel = (d) => {
  const t = dayKey(new Date());
  return d === t ? "Tonight" : d === addDays(t, 1) ? "Tomorrow" : `${dayName(d)} ${dayNum(d)}`;
};

export function WeekStrip({ plan, onDay, choosing, onMakeList, viewer, onOpen }) {
  const phone = usePhone();
  const [gf, setGf] = useState(readGf);
  const [over, setOver] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const days = weekDays(plan.start);
  const empty = days.filter((d) => !plan.byDay[d]).length;
  const atToday = plan.start <= today;

  const drop = (e, d) => {
    e.preventDefault(); setOver(null);
    const id = Number(e.dataTransfer.getData("text/recipe-id") || e.dataTransfer.getData("text/plain"));
    if (id) plan.put(id, d);
  };
  const fill = async () => { setBusy(true); await plan.fill(gf); setBusy(false); };
  const back = () => { const b = addDays(plan.start, -7); plan.setStart(b < today ? today : b); };

  const card = (d) => {
    const m = plan.byDay[d];
    const isChoosing = choosing === d;
    const lit = isChoosing || over === d;
    const tonight = d === today;
    return (
      <button key={d} type="button" onClick={() => onDay(d, m)}
        onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, d)}
        style={{ font: "inherit", textAlign: "left", cursor: "pointer", padding: 6, borderRadius: 14, display: "grid", gap: 5, alignContent: "start",
                 minHeight: phone ? 150 : 122, minWidth: 0, color: "var(--ink)", background: lit ? "#eef6ff" : tonight ? "#fff6ec" : "#fff",
                 ...(phone ? { flex: "0 0 138px", scrollSnapAlign: "start" } : {}),
                 border: `${lit || tonight ? 2 : 1}px ${m ? "solid" : "dashed"} ${lit ? "var(--navy)" : tonight ? "var(--coral)" : "var(--line)"}` }}>
        <span style={{ fontSize: 12, fontWeight: 850, color: tonight ? "var(--coral)" : "var(--muted)" }}>{nightLabel(d)}</span>
        {m ? (
          <>
            <Thumb recipe={m.recipe} />
            <span style={{ fontSize: 13, lineHeight: 1.3, fontWeight: 700 }}>{m.name}</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: "#98a0ad", alignSelf: "center", textAlign: "center", paddingTop: 28 }}>{isChoosing ? "Now tap a recipe ↓" : "+ Add"}</span>
        )}
      </button>
    );
  };

  const gfBox = (
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
      <input type="checkbox" checked={gf} onChange={(e) => { setGf(e.target.checked); saveGf(e.target.checked); }} /> Gluten free only
    </label>
  );

  return (
    <section className="agenda-card" style={{ minWidth: 0 }}>
      <div className="section-title" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2>Dinners</h2>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" className="chip-button" onClick={back} disabled={atToday} aria-label="Earlier">‹</button>
          <span style={{ fontSize: 13, color: "var(--muted)", minWidth: 96, textAlign: "center" }}>{atToday ? "From tonight" : `${monthOf(days[0])} – ${monthOf(days[6])}`}</span>
          <button type="button" className="chip-button" onClick={() => plan.setStart(addDays(plan.start, 7))} aria-label="Next 7 nights">›</button>
        </span>
      </div>

      {phone ? (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollSnapType: "x mandatory", padding: "0 4px 6px", margin: "12px -4px 0" }}>
          {days.map(card)}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
          {days.map(card)}
        </div>
      )}

      <WishList plan={plan} viewer={viewer} onOpen={onOpen} />

      {phone ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <button type="button" className="calendar-add-item" onClick={fill} disabled={busy || !empty} style={{ justifyContent: "center" }}>
              {busy ? "Planning…" : empty ? "✨ Plan the rest" : "✨ All planned"}
            </button>
            <button type="button" className="chip-button" onClick={onMakeList} disabled={!plan.meals.length} style={{ justifyContent: "center" }}>🛒 Shopping list</button>
          </div>
          <div style={{ marginTop: 10 }}>{gfBox}</div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" className="calendar-add-item" onClick={fill} disabled={busy || !empty}>
              {busy ? "Planning…" : empty ? `✨ Plan the rest (${empty} night${empty === 1 ? "" : "s"})` : "✨ All planned"}
            </button>
            {gfBox}
            <span style={{ flex: 1 }} />
            <button type="button" className="chip-button" onClick={onMakeList} disabled={!plan.meals.length}>🛒 Make shopping list</button>
          </div>
          <p style={{ fontSize: 12, color: "#98a0ad", margin: "8px 0 0" }}>Drag a recipe onto a night, or tap a night and then a recipe. Favourites come first; nothing repeats within a fortnight.</p>
        </>
      )}
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
export function PlanButtons({ plan, recipeId, onDone, viewer }) {
  const mine = plan.requests.find((w) => w.recipeId === recipeId && w.member?.id === viewer?.id);
  const who = plan.requests.filter((w) => w.recipeId === recipeId).map((w) => w.member?.name).filter(Boolean);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {viewer && (mine
          ? <button type="button" className="chip-button" onClick={() => plan.dismiss(mine)} style={{ background: "#fffaf0", fontWeight: 800 }}>🙋 You asked for this · undo</button>
          : <button type="button" className="chip-button" onClick={() => plan.ask(recipeId, viewer.id)}>🙋 Can we have this?</button>)}
        {who.length > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>On the wish list: {who.join(", ")}</span>}
      </div>
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
              {here ? "✓ " : ""}{nightLabel(d)}{m && !here ? " •" : ""}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "#98a0ad", margin: "6px 0 0" }}>A dot means that night already has a dinner - tapping it swaps.</p>
    </div>
  );
}

/* Check the cupboard, then add what's needed to the shopping list. */
export function CupboardCheck({ api, plan, viewer, onClose, onAdded, preset = null }) {
  const [list, setList] = useState(null);
  const [got, setGot] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (preset) { setList({ dinners: null, buy: preset, staples: [], onList: 0 }); return; }
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
      if (!preset) await api("/api/plan/listed", { method: "POST", body: JSON.stringify({ start: plan.start }) });
      onAdded?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const need = list ? list.buy.filter((x) => !got[x.name]).length : 0;
  let lastAisle = null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        <p className="eyebrow">CHECK THE CUPBOARD</p>
        <h2>{preset ? "New dinner - anything to buy?" : "What have we already got?"}</h2>
        {!list ? <p style={{ color: "var(--muted)" }}>{error || "Adding up the week…"}</p> : (
          <>
            <p className="sheet-note" style={{ marginTop: 4 }}>
              {preset ? "The dinners changed, so the list has been updated. These are new - " : `${list.dinners} dinner${list.dinners === 1 ? "" : "s"}. `}Tap <strong>Got it</strong> for anything that's already in the house.
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

/* Today screen: tonight's dinner at a glance, tomorrow's underneath. */
export function TonightCard({ api, version, onPlan }) {
  const [week, setWeek] = useState(null);
  useEffect(() => { api(`/api/plan?start=${dayKey(new Date())}`).then(setWeek).catch(() => setWeek(false)); }, [version]);
  if (!week) return null;
  const today = dayKey(new Date());
  const tonight = week.meals.find((m) => m.day === today);
  const tomorrow = week.meals.find((m) => m.day === addDays(today, 1));
  return (
    <section className="task-card" style={{ display: "flex", gap: 14, alignItems: "center", cursor: "pointer" }} onClick={onPlan}>
      <div style={{ width: 84, height: 84, flex: "0 0 auto", borderRadius: 12, overflow: "hidden" }}>
        <Thumb recipe={tonight?.recipe} fill />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="eyebrow">TONIGHT'S DINNER</p>
        <h2 style={{ margin: "2px 0 4px", fontSize: 20 }}>{tonight ? tonight.name : "Nothing planned yet"}</h2>
        <small style={{ color: "var(--muted)" }}>
          {tomorrow ? `Tomorrow: ${tomorrow.name}` : tonight ? "Tomorrow: not planned yet" : "Tap to plan this week's dinners →"}
        </small>
      </div>
    </section>
  );
}

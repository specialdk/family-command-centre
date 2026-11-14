import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePhone } from "./PhoneHome.jsx";
import { useWeekPlan, WeekStrip, DaySheet, PlanButtons, CupboardCheck, dayName } from "./MealPlan.jsx";

/* The family's recipe book. Each card: title, a line, quick facts, and a
   thumbs up / down from whoever is viewing. The family's score decides the
   order, and two or more net thumbs down moves a recipe to "Not for us" -
   kept, never deleted, just no longer suggested. */

const NOT_FOR_US = -2;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "gf", label: "Gluten free" },
  { key: "veg", label: "Vegetarian" },
  { key: "quick", label: "30 min or less" },
  { key: "liked", label: "Family favourites" },
];
const mins = (r) => (r.prepMins || 0) + (r.cookMins || 0);

/* Until a recipe has a picture, an emoji stands in for it. */
const EMOJI = [["pasta", "🍝"], ["mexican", "🌮"], ["curry", "🍛"], ["soup", "🍲"], ["seafood", "🐟"],
  ["salad", "🥗"], ["roast", "🍗"], ["lamb", "🍖"], ["beef", "🥩"], ["chicken", "🍗"], ["pork", "🥓"], ["vegetarian", "🥦"]];
const emojiFor = (r) => (r.title.toLowerCase().includes("pizza") ? "🍕" : (EMOJI.find(([t]) => (r.tags || []).includes(t)) || [0, "🍽️"])[1]);

function Picture({ r, height }) {
  const box = { height, borderRadius: 10, overflow: "hidden", background: "linear-gradient(135deg, #fff4e6, #eef6ff)",
                display: "grid", placeItems: "center", fontSize: Math.round(height / 2.4) };
  return (
    <div style={box}>
      {r.hasImage
        ? <img src={`/api/recipes/${r.id}/image?v=${encodeURIComponent(r.imageAt)}`} alt={r.title} loading="lazy"
               style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span aria-hidden="true">{emojiFor(r)}</span>}
    </div>
  );
}

function Thumbs({ r, onRate, busy }) {
  const btn = (on, tone) => ({
    border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px", cursor: "pointer",
    fontSize: 13, fontWeight: 800, background: on ? `color-mix(in srgb, ${tone} 18%, white)` : "#fff",
    color: on ? tone : "var(--muted)"
  });
  return (
    <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy} style={btn(r.mine > 0, "var(--mint)")} onClick={() => onRate(r, r.mine > 0 ? 0 : 1)} title="We like this">👍 {r.up || ""}</button>
      <button type="button" disabled={busy} style={btn(r.mine < 0, "var(--coral)")} onClick={() => onRate(r, r.mine < 0 ? 0 : -1)} title="Not for us">👎 {r.down || ""}</button>
    </span>
  );
}

function Facts({ r }) {
  const chip = { fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: "#f2f5fb", color: "var(--muted)" };
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {mins(r) > 0 && <span style={chip}>{mins(r)} min</span>}
      {r.glutenFree && <span style={{ ...chip, color: "#2f8f5b", background: "#e9f7ef" }}>GF</span>}
      {r.vegetarian && <span style={{ ...chip, color: "#2f8f5b", background: "#e9f7ef" }}>Veg</span>}
    </span>
  );
}

export default function RecipeBook({ api, viewer, members, onShopping }) {
  const plan = useWeekPlan(api);
  const phone = usePhone();
  const [choosing, setChoosing] = useState(null);   // a night waiting for a recipe
  const [dayOpen, setDayOpen] = useState(null);     // { day, meal }
  const [cupboard, setCupboard] = useState(false);
  const [note, setNote] = useState("");
  const listRef = useRef(null);
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showNot, setShowNot] = useState(false);
  const [pics, setPics] = useState(null);   // background "make all missing pictures" progress

  const loadList = () => api(`/api/recipes?viewer=${viewer?.id ?? ""}`).then(setRecipes).catch((e) => { setError(e.message); setRecipes([]); });
  useEffect(() => { loadList(); }, [viewer?.id]);

  /* While the background job runs, check every 5 seconds and refresh the
     list so pictures appear as they are made. */
  useEffect(() => {
    if (!pics?.job?.running) return undefined;
    const t = setInterval(async () => {
      try { const st = await api("/api/recipes/images/status"); setPics(st); loadList(); } catch { /* keep trying */ }
    }, 5000);
    return () => clearInterval(t);
  }, [pics?.job?.running]);
  useEffect(() => { api("/api/recipes/images/status").then(setPics).catch(() => {}); }, []);

  const makeMissing = async (limit) => {
    setError("");
    try { await api("/api/recipes/images/missing", { method: "POST", body: JSON.stringify({ limit }) }); setPics(await api("/api/recipes/images/status")); }
    catch (e) { setError(e.message); }
  };
  const isParent = viewer?.role === "PARENT";
  const missing = pics ? pics.total - pics.withImage : 0;

  const rate = async (r, value) => {
    if (!viewer?.id) return setError("Choose who you are in Viewing as first.");
    setBusy(true);
    try {
      const updated = await api(`/api/recipes/${r.id}/rate`, { method: "POST", body: JSON.stringify({ memberId: viewer.id, value }) });
      setRecipes((list) => list.map((x) => (x.id === r.id ? updated : x)));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const shown = useMemo(() => {
    if (!recipes) return [];
    const needle = q.trim().toLowerCase();
    return recipes
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || (r.tags || []).some((t) => t.includes(needle)))
      .filter((r) => filter === "all" || (filter === "gf" && r.glutenFree) || (filter === "veg" && r.vegetarian)
        || (filter === "quick" && mins(r) > 0 && mins(r) <= 30) || (filter === "liked" && r.score > 0))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }, [recipes, filter, q]);
  const keep = shown.filter((r) => r.score > NOT_FOR_US);
  const notForUs = shown.filter((r) => r.score <= NOT_FOR_US);

  const grid = { display: "grid", gap: 10, marginTop: 12,
                 gridTemplateColumns: phone ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(250px, 1fr))" };
  const card = (r) => (
    <button key={r.id} type="button" draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/recipe-id", String(r.id)); e.dataTransfer.setData("text/plain", String(r.id)); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={() => { if (choosing) { plan.put(r.id, choosing); setChoosing(null); } else setOpenId(r.id); }}
      style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", borderRadius: 14, background: "#fff",
               padding: phone ? 7 : "10px 10px 12px", display: "grid", gap: phone ? 5 : 7, font: "inherit", color: "var(--ink)", alignContent: "start", minWidth: 0 }}>
      <Picture r={r} height={phone ? 118 : 150} />
      <strong style={{ fontSize: phone ? 14 : 15, lineHeight: 1.25, padding: "0 4px" }}>{r.title}</strong>
      {plan.requests.some((w) => w.recipeId === r.id) && (
        <span style={{ fontSize: 12, color: "var(--coral)", fontWeight: 700, padding: "0 4px" }}>
          🙋 {plan.requests.filter((w) => w.recipeId === r.id).map((w) => w.member?.name || "someone").join(", ")} asked for this
        </span>
      )}
      {!phone && <span style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>{r.summary}</span>}
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Facts r={r} />
        <Thumbs r={r} onRate={rate} busy={busy} />
      </span>
    </button>
  );

  return (
    <div style={{ display: "grid", gap: phone ? 14 : 18, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <WeekStrip plan={plan} choosing={choosing} onMakeList={() => setCupboard(true)} viewer={viewer} onOpen={setOpenId}
        onDay={(d, m) => {
          if (m) { setChoosing(null); setDayOpen({ day: d, meal: m }); }
          else { setChoosing(choosing === d ? null : d); listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
        }} />
      {note && <div className="alert" style={{ background: "#eefaf1", borderColor: "var(--mint)", color: "var(--ink)" }}>{note}</div>}

      <section className="agenda-card" ref={listRef}>
        <div className="section-title">
          <h2>Recipes</h2>
          <span className="count-badge">{recipes?.length ?? "…"}</span>
        </div>
        <p style={{ color: "var(--muted)", margin: "8px 0 12px", fontSize: 14, display: phone ? "none" : undefined }}>
          Give each one a 👍 or 👎. Favourites rise to the top, and anything the family doesn't want moves to "Not for us".
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: phone ? "nowrap" : "wrap", alignItems: "center", ...(phone ? { flexDirection: "column", alignItems: "stretch", marginTop: 10 } : {}) }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={phone ? "Search recipes" : "Search - e.g. chicken, pasta, quick"}
                 style={{ flex: phone ? "none" : "1 1 220px", minWidth: 0 }} />
          <div style={{ display: "flex", gap: 8, ...(phone ? { overflowX: "auto", paddingBottom: 4, margin: "0 -4px", padding: "0 4px 4px" } : { flexWrap: "wrap" }) }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className="chip-button" onClick={() => setFilter(f.key)}
                style={{ flex: "0 0 auto", whiteSpace: "nowrap", ...(filter === f.key ? { background: "var(--navy)", color: "#fff" } : {}) }}>{f.label}</button>
            ))}
          </div>
        </div>
        {isParent && !phone && pics && (missing > 0 || pics.job?.running) && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
            {pics.job?.running ? (
              <span>🎨 Making pictures… {pics.job.done + pics.job.failed} of {pics.job.total} done{pics.job.failed ? ` (${pics.job.failed} failed)` : ""}. Carry on — they appear as they finish.</span>
            ) : (
              <>
                <span>{missing} recipe{missing === 1 ? "" : "s"} without a picture.</span>
                <button type="button" className="chip-button" onClick={() => makeMissing(3)}>Try 3 first</button>
                <button type="button" className="chip-button" onClick={() => makeMissing(100)}>Make all {missing}</button>
              </>
            )}
            {pics.job?.lastError && <span style={{ color: "var(--coral)" }}>Last error: {pics.job.lastError}</span>}
          </div>
        )}
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
        {choosing && (
          <div style={{ position: "sticky", top: 8, zIndex: 5, marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--navy)", color: "#fff", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ flex: 1 }}>Tap a recipe for <strong>{dayName(choosing, true)}</strong></span>
            <button type="button" className="chip-button" onClick={() => setChoosing(null)}>Cancel</button>
          </div>
        )}
      </section>

      <section className="task-card">
        {recipes === null ? <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
          : keep.length ? <div style={grid}>{keep.map(card)}</div>
          : <p style={{ color: "var(--muted)", margin: 0 }}>Nothing matches.</p>}
      </section>

      {notForUs.length > 0 && (
        <section className="task-card">
          <div className="section-title">
            <h2>Not for us</h2>
            <button type="button" onClick={() => setShowNot((x) => !x)}>{showNot ? "Hide" : `Show ${notForUs.length}`}</button>
          </div>
          {showNot && <div style={grid}>{notForUs.map(card)}</div>}
        </section>
      )}

      {dayOpen && (
        <DaySheet day={dayOpen.day} meal={dayOpen.meal} onClose={() => setDayOpen(null)}
          onOpen={() => { setOpenId(dayOpen.meal.recipeId); setDayOpen(null); }}
          onSwap={() => { setChoosing(dayOpen.day); setDayOpen(null); listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          onRemove={async () => { await plan.remove(dayOpen.meal); setDayOpen(null); }} />
      )}
      {cupboard && (
        <CupboardCheck api={api} plan={plan} viewer={viewer} onClose={() => setCupboard(false)}
          onAdded={async () => { await onShopping?.(); setNote("Added to the Shopping list ✓"); setTimeout(() => setNote(""), 5000); }} />
      )}
      {openId && <RecipeSheet plan={plan} id={openId} api={api} viewer={viewer} members={members} onRate={rate} busy={busy} onClose={() => setOpenId(null)} onPicture={loadList}
                               summary={recipes?.find((r) => r.id === openId)} />}
    </div>
  );
}

function RecipeSheet({ plan, id, api, viewer, members, onClose, onRate, busy, summary, onPicture }) {
  const [r, setR] = useState(null);
  const [painting, setPainting] = useState(false);
  const [picNote, setPicNote] = useState("");
  const paint = async () => {
    setPainting(true); setPicNote("");
    try { const out = await api(`/api/recipes/${id}/image`, { method: "POST" }); setPicNote(`Done in ${out.secs} seconds.`); await onPicture?.(); }
    catch (e) { setPicNote(e.message); }
    setPainting(false);
  };
  useEffect(() => { api(`/api/recipes/${id}?viewer=${viewer?.id ?? ""}`).then(setR).catch(() => setR(false)); }, [id]);
  const live = summary ? { ...r, ...summary } : r;   // ratings update live from the list
  const names = (ids) => (ids || []).map((m) => members.find((x) => x.id === m)?.name).filter(Boolean).join(", ");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        {!r ? <p style={{ color: "var(--muted)" }}>{r === false ? "That recipe isn't here." : "Loading…"}</p> : (
          <>
            <Picture r={live} height={220} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 4px", fontSize: 13, color: "var(--muted)" }}>
              <button type="button" className="chip-button" onClick={paint} disabled={painting}>
                {painting ? "🎨 Making a picture… (about 30 seconds)" : live.hasImage ? "🎨 New picture" : "🎨 Make a picture"}
              </button>
              {picNote && <span>{picNote}</span>}
            </div>
            <p className="eyebrow">RECIPE · SERVES {live.serves}{mins(live) ? ` · ${mins(live)} MIN` : ""}</p>
            <h2>{live.title}</h2>
            <p style={{ margin: "6px 0 10px", color: "var(--muted)" }}>{live.summary}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Facts r={live} />
              <Thumbs r={live} onRate={onRate} busy={busy} />
            </div>
            {(live.upBy?.length > 0 || live.downBy?.length > 0) && (
              <p style={{ fontSize: 12, color: "#98a0ad", margin: "6px 0 0" }}>
                {live.upBy?.length ? `👍 ${names(live.upBy)}` : ""}{live.upBy?.length && live.downBy?.length ? " · " : ""}{live.downBy?.length ? `👎 ${names(live.downBy)}` : ""}
              </p>
            )}

            <p className="eyebrow" style={{ marginTop: 16 }}>INGREDIENTS</p>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7, fontSize: 14 }}>
              {(r.ingredients || []).map((x, i) => <li key={i}><strong>{x.qty}</strong> {x.item}</li>)}
            </ul>

            <p className="eyebrow" style={{ marginTop: 16 }}>METHOD</p>
            <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6, fontSize: 14 }}>
              {(r.method || []).map((step, i) => <li key={i} style={{ marginBottom: 6 }}>{step}</li>)}
            </ol>
            {live.glutenFree && (
              <p className="sheet-note" style={{ marginTop: 10 }}>Gluten free with ordinary ingredients — where it says "check label", brands vary.</p>
            )}
            {plan && <PlanButtons plan={plan} recipeId={live.id} viewer={viewer} />}
            <div className="sheet-actions" style={{ marginTop: 16 }}>
              <button type="button" className="chip-button" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

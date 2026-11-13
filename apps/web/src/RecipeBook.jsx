import React, { useEffect, useMemo, useState } from "react";

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

export default function RecipeBook({ api, viewer, members }) {
  const [recipes, setRecipes] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showNot, setShowNot] = useState(false);

  useEffect(() => {
    api(`/api/recipes?viewer=${viewer?.id ?? ""}`).then(setRecipes).catch((e) => { setError(e.message); setRecipes([]); });
  }, [viewer?.id]);

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

  const grid = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", marginTop: 12 };
  const card = (r) => (
    <button key={r.id} type="button" onClick={() => setOpenId(r.id)}
      style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", borderRadius: 14, background: "#fff",
               padding: "12px 14px", display: "grid", gap: 7, font: "inherit", color: "var(--ink)" }}>
      <strong style={{ fontSize: 15 }}>{r.title}</strong>
      <span style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.4 }}>{r.summary}</span>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Facts r={r} />
        <Thumbs r={r} onRate={rate} busy={busy} />
      </span>
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="agenda-card">
        <div className="section-title">
          <h2>Recipes</h2>
          <span className="count-badge">{recipes?.length ?? "…"}</span>
        </div>
        <p style={{ color: "var(--muted)", margin: "8px 0 12px", fontSize: 14 }}>
          Give each one a 👍 or 👎. Favourites rise to the top, and anything the family doesn't want moves to "Not for us".
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search - e.g. chicken, pasta, quick"
                 style={{ flex: "1 1 220px", minWidth: 0 }} />
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="chip-button" onClick={() => setFilter(f.key)}
              style={filter === f.key ? { background: "var(--navy)", color: "#fff" } : undefined}>{f.label}</button>
          ))}
        </div>
        {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
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

      {openId && <RecipeSheet id={openId} api={api} viewer={viewer} members={members} onRate={rate} busy={busy} onClose={() => setOpenId(null)}
                               summary={recipes?.find((r) => r.id === openId)} />}
    </div>
  );
}

function RecipeSheet({ id, api, viewer, members, onClose, onRate, busy, summary }) {
  const [r, setR] = useState(null);
  useEffect(() => { api(`/api/recipes/${id}?viewer=${viewer?.id ?? ""}`).then(setR).catch(() => setR(false)); }, [id]);
  const live = summary ? { ...r, ...summary } : r;   // ratings update live from the list
  const names = (ids) => (ids || []).map((m) => members.find((x) => x.id === m)?.name).filter(Boolean).join(", ");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="event-detail-sheet sheet-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflowY: "auto" }}>
        {!r ? <p style={{ color: "var(--muted)" }}>{r === false ? "That recipe isn't here." : "Loading…"}</p> : (
          <>
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
            <div className="sheet-actions" style={{ marginTop: 16 }}>
              <button type="button" className="chip-button" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

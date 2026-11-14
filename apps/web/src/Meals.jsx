import React, { useState } from "react";
import RecipeBook from "./RecipeBook.jsx";
import ShoppingList from "./Shopping.jsx";
import { useWeekPlan, CupboardCheck } from "./MealPlan.jsx";

/* Meals & Shopping: one job in three steps - plan the nights, pick from the
   book, buy what's missing. One screen with tabs, opening on the tab used
   last (so in the shop it's one tap to the list). */

const TABS = [["plan", "Plan"], ["recipes", "Recipes"], ["shopping", "Shopping"]];
const KEY = "fcc-meals-tab";
export const recallMealsTab = () => { try { return localStorage.getItem(KEY) || "plan"; } catch { return "plan"; } };
const remember = (t) => { try { localStorage.setItem(KEY, t); } catch { /* fine */ } };

export default function Meals({ api, viewer, members, items, onChange, sub, setSub }) {
  const plan = useWeekPlan(api, { onSynced: onChange });
  const [choosing, setChoosing] = useState(null);
  const go = (t) => { setSub(t); remember(t); window.scrollTo?.({ top: 0 }); };
  const left = (items || []).filter((i) => !i.checked && i.aisle !== "Check you have").length;

  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="view-switch" style={{ display: "flex", width: "100%", maxWidth: 520 }}>
        {TABS.map(([k, label]) => (
          <button key={k} className={sub === k ? "selected" : ""} onClick={() => go(k)} style={{ flex: 1 }}>
            {label}{k === "shopping" && left ? ` · ${left}` : ""}
          </button>
        ))}
      </div>
      {(sub === "plan" || sub === "recipes") && (
        <RecipeBook api={api} viewer={viewer} members={members} onShopping={onChange}
          plan={plan} choosing={choosing} setChoosing={setChoosing} mode={sub} onGoTab={go} />
      )}
      {sub === "shopping" && <ShoppingList api={api} items={items} viewer={viewer} onChange={onChange} onSync={plan.sync} />}
      {plan.newItems && (
        <CupboardCheck api={api} plan={plan} viewer={viewer} preset={plan.newItems}
          onClose={plan.clearNewItems} onAdded={onChange} />
      )}
    </div>
  );
}

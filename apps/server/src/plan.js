import { Router } from "express";
import { zonedToUtc } from "./ideas.js";
import { NOT_FOR_US } from "./recipes.js";

/* The week's dinners, and the shopping list that comes out of them.

   One dinner a night, at 6 pm. "Plan my week" fills the empty nights from
   the family's thumbs-up recipes first, then the unrated ones, never one
   the family has voted "Not for us", and nothing eaten in the last
   fortnight. It is plain code, not AI: instant, free, and predictable.

   "Make shopping list" adds up the ingredients for the week and splits off
   the staples (salt, oil, garlic...) into a "check you have" group, so the
   cupboard check only asks about the things worth asking about. */

const DAY = 86400000;
const STAPLES = [
  "salt", "pepper", "olive oil", "oil", "garlic", "plain flour", "self-raising flour", "cornflour",
  "sugar", "brown sugar", "honey", "butter", "dried oregano", "ground cumin", "smoked paprika",
  "sesame oil", "white vinegar", "tomato paste", "worcestershire sauce", "mild curry powder"
];
const AISLE_ORDER = ["Produce", "Meat", "Seafood", "Dairy", "Bakery", "Pantry", "Frozen", "Other"];
const isStaple = (item) => {
  const t = String(item).toLowerCase().replace(/\(.*?\)/g, "").trim();
  return STAPLES.some((s) => t === s || t.endsWith(` ${s}`) && s.split(" ").length > 1 || t === `${s}s`);
};
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createPlan({ prisma, familyTz }) {
  const router = Router();
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d);
  const range = (start) => {
    const from = zonedToUtc(start, "00:00", familyTz);
    return { from, to: new Date(from.getTime() + 7 * DAY) };
  };
  const days = (start) => Array.from({ length: 7 }, (_, i) => dayKey(new Date(zonedToUtc(start, "12:00", familyTz).getTime() + i * DAY)));
  const RECIPE = { select: { id: true, title: true, imageAt: true, glutenFree: true, vegetarian: true, tags: true } };

  async function weekMeals(start) {
    const { from, to } = range(start);
    return prisma.meal.findMany({ where: { plannedFor: { gte: from, lt: to } }, include: { recipe: RECIPE }, orderBy: { plannedFor: "asc" } });
  }

  router.get("/", async (req, res) => {
    const start = String(req.query.start || dayKey(new Date()));
    const meals = await weekMeals(start);
    res.json({ start, days: days(start), meals: meals.map((m) => ({ ...m, day: dayKey(m.plannedFor) })) });
  });

  /* Put a recipe on a night - replacing whatever was there. */
  router.post("/", async (req, res) => {
    const recipe = await prisma.recipe.findUnique({ where: { id: Number(req.body?.recipeId) }, select: { id: true, title: true } });
    const date = String(req.body?.date || "");
    if (!recipe || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Pick a recipe and a day." });
    const { from, to } = range(date);
    await prisma.meal.deleteMany({ where: { plannedFor: { gte: from, lt: new Date(from.getTime() + DAY) } } });
    const meal = await prisma.meal.create({
      data: { name: recipe.title, recipeId: recipe.id, plannedFor: zonedToUtc(date, "18:00", familyTz) }
    });
    res.status(201).json(meal);
  });

  router.delete("/:id", async (req, res) => {
    await prisma.meal.deleteMany({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });

  /* Fill the empty nights of a week. */
  router.post("/fill", async (req, res) => {
    const start = String(req.body?.start || dayKey(new Date()));
    const glutenFree = !!req.body?.glutenFree;
    const meals = await weekMeals(start);
    const taken = new Set(meals.map((m) => dayKey(m.plannedFor)));
    const empty = days(start).filter((d) => !taken.has(d));
    if (!empty.length) return res.json({ added: 0 });

    const { from } = range(start);
    const recent = await prisma.meal.findMany({
      where: { plannedFor: { gte: new Date(from.getTime() - 14 * DAY), lt: new Date(from.getTime() + 7 * DAY) }, recipeId: { not: null } },
      select: { recipeId: true }
    });
    const avoid = new Set(recent.map((m) => m.recipeId));
    const all = await prisma.recipe.findMany({
      where: glutenFree ? { glutenFree: true } : {},
      select: { id: true, title: true, ratings: { select: { value: true } } }
    });
    const scored = all.map((r) => ({ ...r, score: r.ratings.reduce((n, x) => n + x.value, 0) }))
      .filter((r) => r.score > NOT_FOR_US && !avoid.has(r.id));
    const pool = [...shuffle(scored.filter((r) => r.score > 0)), ...shuffle(scored.filter((r) => r.score <= 0))];

    let added = 0;
    for (const d of empty) {
      const r = pool.shift();
      if (!r) break;
      await prisma.meal.create({ data: { name: r.title, recipeId: r.id, plannedFor: zonedToUtc(d, "18:00", familyTz) } });
      added++;
    }
    res.json({ added, short: empty.length - added });
  });

  /* Everything the week's dinners need, added up, staples set apart. */
  router.post("/shopping", async (req, res) => {
    const start = String(req.body?.start || dayKey(new Date()));
    const meals = await weekMeals(start);
    const ids = meals.map((m) => m.recipeId).filter(Boolean);
    const recipes = await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, ingredients: true } });
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const lines = new Map();
    for (const m of meals) {
      const r = byId.get(m.recipeId);
      if (!r) continue;
      for (const ing of r.ingredients || []) {
        const name = String(ing.item || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const line = lines.get(key) || { name, qty: [], aisle: ing.aisle || "Other", for: [], staple: isStaple(name) };
        if (ing.qty && ing.qty !== "to serve") line.qty.push(ing.qty);
        if (!line.for.includes(r.title)) line.for.push(r.title);
        lines.set(key, line);
      }
    }
    const all = [...lines.values()].map((l) => ({ ...l, qty: l.qty.join(" + ") || null }))
      .sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
    res.json({ dinners: meals.length, buy: all.filter((l) => !l.staple), staples: all.filter((l) => l.staple) });
  });

  return { router };
}

/* Shopping list routes beyond the basics: adding many at once (from the
   plan), removing one, and clearing what has been ticked off. */
export function createShopping({ prisma }) {
  const router = Router();
  router.post("/bulk", async (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 200)
      .filter((i) => String(i?.name || "").trim());
    const addedById = Number(req.body?.actorId) || null;
    if (items.length) {
      await prisma.shoppingItem.createMany({
        data: items.map((i, n) => ({
          name: String(i.name).trim().slice(0, 120), quantity: i.qty ? String(i.qty).slice(0, 120) : null,
          aisle: i.aisle || null, note: i.for?.length ? i.for.join(", ").slice(0, 200) : null,
          addedById, position: n
        }))
      });
    }
    res.json({ ok: true, added: items.length });
  });
  router.delete("/checked", async (_req, res) => {
    const { count } = await prisma.shoppingItem.deleteMany({ where: { checked: true } });
    res.json({ ok: true, removed: count });
  });
  router.delete("/:id", async (req, res) => {
    await prisma.shoppingItem.deleteMany({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });
  return { router };
}

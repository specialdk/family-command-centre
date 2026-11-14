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

/* Jade's dinner tools. Anyone can ask for a dinner; it goes on the wish
   list, not straight onto a night, so tonight's plan never changes under
   whoever is cooking. */
export const MEAL_TOOLS = [
  {
    name: "request_dinner",
    description:
      "Add a dinner to the family's wish list, when someone says what they'd like to have " +
      "(\"can we have tacos?\", \"I want spaghetti bolognese this week\"). It is NOT planned onto a " +
      "night - whoever plans the week sees the wish list and fits it in. Saved straight away.",
    parameters: {
      type: "object",
      properties: { dish: { type: "string", description: "What they asked for, e.g. \"beef tacos\"" } },
      required: ["dish"]
    }
  },
  {
    name: "add_to_shopping",
    description:
      "Put something on the family shopping list (\"add milk\", \"we need dog food from Drakes\", \"we're out of pasta\"). " +
      "Saved straight away. Only give a store if they name one; otherwise it goes where the family usually buys it.",
    parameters: {
      type: "object",
      properties: {
        item: { type: "string", description: "The thing, e.g. \"milk\"" },
        quantity: { type: "string", description: "Only if they say, e.g. \"2 litres\"" },
        store: { type: "string", description: "Only if they name one: ALDI, Coles, Drakes or Costco" }
      },
      required: ["item"]
    }
  },
  {
    name: "whats_for_dinner",
    description: "The dinners planned for the next seven nights, and what is on the wish list. Use for \"what's for dinner?\".",
    parameters: { type: "object", properties: {} }
  }
];
export const MEAL_NAMES = new Set(MEAL_TOOLS.map((t) => t.name));
const words = (t) => String(t).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["and", "with", "the", "can", "have", "some"].includes(w));
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

/* ------------------------------------------------------------- shopping --
   Rhian's design: the family shops at a few local stores, and each product
   has a usual one. The list groups by store, then aisle. Whenever someone
   sets an item's store it is remembered (ProductPref), so next time "dog
   food" lands under Drakes without asking. */

export const STORES = ["ALDI", "Coles", "Drakes", "Costco"];
export const cleanStore = (s) => {
  const t = String(s || "").trim();
  if (!t) return null;
  return STORES.find((x) => x.toLowerCase() === t.toLowerCase()) || t.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
};

/* "Carrots", "carrot (diced)" and "carrot" are the same thing to buy. */
const singular = (w) => /ies$/.test(w) ? w.replace(/ies$/, "y") : /(oes|ches|shes|xes)$/.test(w) ? w.replace(/es$/, "") : /[^s]s$/.test(w) ? w.slice(0, -1) : w;
export const itemKey = (name) => {
  const words = String(name || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
};
export const nice = (name) => { const t = String(name || "").trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };

const AISLE_WORDS = [
  ["Dairy", /\b(milk|cheese|yoghurt|yogurt|butter|cream|egg|eggs|feta|parmesan|mozzarella)\b/],
  ["Meat", /\b(chicken|beef|lamb|pork|mince|sausage|sausages|bacon|ham|steak|turkey)\b/],
  ["Seafood", /\b(fish|salmon|prawn|prawns|tuna|barramundi|seafood)\b/],
  ["Bakery", /\b(bread|loaf|loaves|roll|rolls|wrap|wraps|bun|buns|tortilla|tortillas|croissant)\b/],
  ["Frozen", /\b(frozen|ice cream|peas|chips)\b/],
  ["Produce", /\b(apple|apples|banana|bananas|orange|lemon|lime|avocado|tomato|tomatoes|potato|potatoes|onion|onions|carrot|carrots|lettuce|spinach|broccoli|zucchini|capsicum|cucumber|mushroom|mushrooms|garlic|ginger|herb|herbs|parsley|coriander|basil|fruit|berries|grapes|pumpkin|corn|celery|kale)\b/],
  ["Household", /\b(tablet|tablets|detergent|toilet paper|paper towel|bin bag|bin bags|soap|shampoo|toothpaste|dog food|cat food|pet|cleaner|sponge|foil|cling)\b/],
  ["Pantry", /\b(rice|pasta|spaghetti|flour|sugar|oil|stock|sauce|tin|tinned|can|beans|cereal|oats|coffee|tea|honey|jam|vinegar|spice|salt|pepper|noodles|biscuits)\b/]
];
export const guessAisle = (name) => {
  const t = String(name || "").toLowerCase();
  return (AISLE_WORDS.find(([, re]) => re.test(t)) || [null])[0];
};

export async function learnPref(prisma, name, { store, aisle }) {
  const key = itemKey(name);
  if (!key) return;
  const data = { ...(store !== undefined ? { store } : {}), ...(aisle ? { aisle } : {}) };
  if (!Object.keys(data).length) return;
  await prisma.productPref.upsert({ where: { key }, create: { key, ...data }, update: data }).catch(() => {});
}
async function prefsFor(prisma, names) {
  const keys = [...new Set(names.map(itemKey).filter(Boolean))];
  const rows = keys.length ? await prisma.productPref.findMany({ where: { key: { in: keys } } }) : [];
  return new Map(rows.map((r) => [r.key, r]));
}

/* One item onto the list - from the add box, from Jade, or anywhere else.
   An explicit store is remembered; no store means "where we usually get it". */
export async function addShoppingItem(prisma, { name, quantity, store, aisle, actorId, note }) {
  const clean = nice(String(name || "").trim().slice(0, 120));
  if (!clean) return null;
  const pref = (await prefsFor(prisma, [clean])).get(itemKey(clean));
  const chosen = store !== undefined && store !== "" ? cleanStore(store) : undefined;
  if (chosen) await learnPref(prisma, clean, { store: chosen });
  return prisma.shoppingItem.create({
    data: {
      name: clean, quantity: quantity ? String(quantity).slice(0, 120) : null,
      store: chosen ?? pref?.store ?? null,
      aisle: aisle || pref?.aisle || guessAisle(clean),
      note: note ? String(note).slice(0, 200) : null,
      addedById: actorId ? Number(actorId) : null
    }
  });
}

/* Quantities from several recipes: "1 + 1 + 1" -> "3", "200 g + 300 g" -> "500 g". */
export function sumQty(list) {
  const totals = new Map(); const other = [];
  for (const q of list) {
    const m = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(String(q).trim());
    if (!m) { other.push(q); continue; }
    const unit = m[2].trim().toLowerCase();
    totals.set(unit, (totals.get(unit) || 0) + Number(m[1]));
  }
  const out = [...totals].map(([u, n]) => `${Math.round(n * 100) / 100}${u ? ` ${u}` : ""}`);
  return [...out, ...other].join(" + ") || null;
}

export function createPlan({ prisma, familyTz }) {
  const router = Router();
  const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d);
  const range = (start) => {
    const from = zonedToUtc(start, "00:00", familyTz);
    return { from, to: new Date(from.getTime() + 7 * DAY) };
  };
  const days = (start) => Array.from({ length: 7 }, (_, i) => dayKey(new Date(zonedToUtc(start, "12:00", familyTz).getTime() + i * DAY)));
  const RECIPE = { select: { id: true, title: true, imageAt: true, glutenFree: true, vegetarian: true, tags: true } };
  const openRequests = () => prisma.mealRequest.findMany({
    where: { plannedAt: null }, orderBy: { createdAt: "asc" },
    include: { recipe: RECIPE, member: { select: { id: true, name: true } } }
  });
  const markPlanned = (recipeIds) => recipeIds.length
    ? prisma.mealRequest.updateMany({ where: { plannedAt: null, recipeId: { in: recipeIds } }, data: { plannedAt: new Date() } })
    : null;

  /* "Tacos" -> Beef tacos. Exact or contained title first, then most words in common. */
  async function matchRecipe(dish) {
    const all = await prisma.recipe.findMany({ select: { id: true, title: true } });
    const d = String(dish).toLowerCase().trim();
    const direct = all.find((r) => r.title.toLowerCase() === d) || all.find((r) => r.title.toLowerCase().includes(d) || d.includes(r.title.toLowerCase()));
    if (direct) return direct;
    const want = words(d);
    let best = null, bestN = 0;
    for (const r of all) {
      const n = words(r.title).filter((w) => want.some((x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))).length;
      if (n > bestN) { best = r; bestN = n; }
    }
    return best;
  }

  async function addRequest({ recipeId, title, memberId }) {
    const recipe = recipeId ? await prisma.recipe.findUnique({ where: { id: Number(recipeId) }, select: { id: true, title: true } }) : null;
    const name = recipe?.title || String(title || "").trim().slice(0, 120);
    if (!name) return null;
    const same = await prisma.mealRequest.findFirst({
      where: { plannedAt: null, memberId: memberId || null, ...(recipe ? { recipeId: recipe.id } : { title: { equals: name, mode: "insensitive" } }) }
    });
    return same || prisma.mealRequest.create({ data: { title: name, recipeId: recipe?.id ?? null, memberId: memberId || null } });
  }

  /* For Jade. Returns { output }. */
  async function runTool(name, args, { speaker }) {
    if (name === "request_dinner") {
      const dish = String(args.dish || "").trim();
      if (!dish) return { output: "Ask what they'd like for dinner." };
      const recipe = await matchRecipe(dish);
      const r = await addRequest({ recipeId: recipe?.id, title: recipe ? null : dish, memberId: speaker?.id });
      return { output: recipe
        ? `Added "${r.title}" to the dinner wish list${speaker ? ` for ${speaker.name}` : ""}. Say it's on the wish list for when the week gets planned - not necessarily tonight. If "${r.title}" isn't what they meant, say so.`
        : `There's no "${dish}" in the recipe book, but it's on the wish list as "${r.title}". Say so in a few words.` };
    }
    if (name === "add_to_shopping") {
      const it = await addShoppingItem(prisma, { name: args.item, quantity: args.quantity, store: args.store || undefined, actorId: speaker?.id });
      if (!it) return { output: "Ask what to add." };
      return { output: `Added ${it.name}${it.quantity ? ` (${it.quantity})` : ""} to the shopping list${it.store ? ` under ${it.store}` : ""}. Confirm in a few words.` };
    }
    if (name === "whats_for_dinner") {
      const today = dayKey(new Date());
      const meals = await weekMeals(today);
      const wish = await openRequests();
      const plan = days(today).map((d) => {
        const m = meals.find((x) => dayKey(x.plannedFor) === d);
        const label = new Intl.DateTimeFormat("en-AU", { timeZone: familyTz, weekday: "long" }).format(zonedToUtc(d, "12:00", familyTz));
        return `${d === today ? "Tonight" : label}: ${m ? m.name : "nothing planned yet"}`;
      });
      return { output: `${plan.join(". ")}.${wish.length ? ` Wish list: ${wish.map((w) => `${w.title}${w.member ? ` (${w.member.name})` : ""}`).join(", ")}.` : ""} Answer what they asked, briefly.` };
    }
    return { output: "Unknown dinner tool." };
  }

  router.get("/requests", async (_req, res) => res.json(await openRequests()));
  router.post("/requests", async (req, res) => {
    const r = await addRequest({ recipeId: req.body?.recipeId, title: req.body?.title, memberId: Number(req.body?.memberId) || null });
    if (!r) return res.status(400).json({ error: "What would you like?" });
    res.status(201).json(r);
  });
  router.delete("/requests/:id", async (req, res) => {
    await prisma.mealRequest.deleteMany({ where: { id: Number(req.params.id) } });
    res.json({ ok: true });
  });

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
    await markPlanned([recipe.id]);
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
    const rest = [...shuffle(scored.filter((r) => r.score > 0)), ...shuffle(scored.filter((r) => r.score <= 0))];
    /* The wish list goes first (oldest request first), as long as it fits -
       gluten free when asked, and not already on this week. */
    const inWeek = new Set(meals.map((m) => m.recipeId));
    const byId = new Map(all.map((r) => [r.id, r]));
    const wished = [];
    for (const w of await openRequests()) {
      const r = w.recipeId && byId.get(w.recipeId);
      if (r && !inWeek.has(r.id) && !wished.includes(r)) wished.push(r);
    }
    const wishedIds = new Set(wished.map((r) => r.id));
    const pool = [...wished, ...rest.filter((r) => !wishedIds.has(r.id))];
    const placed = [];

    let added = 0;
    for (const d of empty) {
      const r = pool.shift();
      if (!r) break;
      await prisma.meal.create({ data: { name: r.title, recipeId: r.id, plannedFor: zonedToUtc(d, "18:00", familyTz) } });
      placed.push(r.id);
      added++;
    }
    await markPlanned(placed);
    res.json({ added, short: empty.length - added, wished: wished.filter((r) => placed.includes(r.id)).length });
  });

  /* Everything the week's dinners need, added up, staples set apart. */
  /* What the given dinners need, added up by product. */
  async function needFor(meals) {
    const ids = [...new Set(meals.map((m) => m.recipeId).filter(Boolean))];
    const recipes = await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, ingredients: true } });
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const lines = new Map();
    for (const m of meals) {
      const r = byId.get(m.recipeId);
      if (!r) continue;
      for (const ing of r.ingredients || []) {
        const name = String(ing.item || "").trim();
        if (!name) continue;
        const key = itemKey(name);
        const line = lines.get(key) || { key, name: nice(name), qty: [], aisle: ing.aisle || "Other", for: [], ids: [], staple: isStaple(name) };
        if (ing.qty && ing.qty !== "to serve") line.qty.push(ing.qty);
        if (!line.for.includes(r.title)) line.for.push(r.title);
        if (!line.ids.includes(r.id)) line.ids.push(r.id);
        lines.set(key, line);
      }
    }
    const prefs = await prefsFor(prisma, [...lines.values()].map((l) => l.name));
    return [...lines.values()].map((l) => ({ ...l, qty: sumQty(l.qty), store: prefs.get(l.key)?.store || null }))
      .sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
  }

  const getSetting = () => prisma.familySetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });

  /* The cupboard check finished: remember which dinners this list covers. */
  router.post("/listed", async (req, res) => {
    const start = String(req.body?.start || dayKey(new Date()));
    const { from, to } = range(start);
    const meals = await weekMeals(start);
    await getSetting();
    await prisma.familySetting.update({ where: { id: 1 }, data: {
      listFrom: from, listTo: to, listRecipeIds: [...new Set(meals.map((m) => m.recipeId).filter(Boolean))]
    } });
    res.json({ ok: true });
  });

  /* Keep the list in step with the dinners. Called after any change to the
     plan (and by "Update from dinners"). Removing or swapping a dinner takes
     its ingredients off - unless they're ticked, typed in by hand, or still
     needed by another dinner. A new dinner's ingredients come back as
     "ask", for a quick cupboard check of just those. */
  router.post("/sync", async (_req, res) => {
    const s = await getSetting();
    if (!s.listFrom || !s.listTo) return res.json({ active: false, removed: 0, updated: 0, ask: [] });
    const meals = await prisma.meal.findMany({ where: { plannedFor: { gte: s.listFrom, lt: s.listTo } } });
    const current = new Set(meals.map((m) => m.recipeId).filter(Boolean));
    const old = new Set(s.listRecipeIds || []);
    const added = new Set([...current].filter((id) => !old.has(id)));
    const needed = new Map((await needFor(meals)).map((l) => [l.key, l]));
    const items = await prisma.shoppingItem.findMany();
    let removed = 0, updated = 0;
    const seen = new Set();

    for (const it of items) {
      const key = itemKey(it.name);
      if (!it.checked) seen.add(key);
      if (it.checked || !(it.recipeIds || []).length) continue;
      const line = needed.get(key);
      const keep = (line?.ids || []).filter((id) => it.recipeIds.includes(id) || added.has(id));
      if (!keep.length) {
        await prisma.shoppingItem.delete({ where: { id: it.id } }); removed++; seen.delete(key);
        continue;
      }
      const forTitles = line.for.join(", ").slice(0, 200);
      if (keep.join() !== it.recipeIds.join() || line.qty !== it.quantity || forTitles !== it.note) {
        await prisma.shoppingItem.update({ where: { id: it.id }, data: { recipeIds: keep, quantity: line.qty, note: forTitles } });
        updated++;
      }
    }

    const ask = [];
    for (const line of needed.values()) {
      if (!line.ids.some((id) => added.has(id)) || seen.has(line.key)) continue;
      if (line.staple) {
        await prisma.shoppingItem.create({ data: { name: line.name, quantity: line.qty, aisle: "Check you have", note: line.for.join(", ").slice(0, 200), recipeIds: line.ids, store: line.store } });
        updated++;
      } else ask.push(line);
    }
    await prisma.familySetting.update({ where: { id: 1 }, data: { listRecipeIds: [...current] } });
    res.json({ active: true, removed, updated, ask });
  });

  /* Everything the dinners need, for the cupboard check. */
  router.post("/shopping", async (req, res) => {
    const start = String(req.body?.start || dayKey(new Date()));
    const meals = await weekMeals(start);
    const all = await needFor(meals);
    res.json({ dinners: meals.length, buy: all.filter((l) => !l.staple), staples: all.filter((l) => l.staple) });
  });

  return { router, runTool };
}

/* Shopping list routes beyond the basics: adding many at once (from the
   plan), removing one, and clearing what has been ticked off. */
export function createShopping({ prisma }) {
  const router = Router();

  router.get("/stores", (_req, res) => res.json(STORES));

  router.post("/", async (req, res) => {
    const b = req.body || {};
    const item = await addShoppingItem(prisma, { name: b.name, quantity: b.quantity, store: b.store, aisle: b.aisle, actorId: b.actorId, note: b.note });
    if (!item) return res.status(400).json({ error: "Item name is required" });
    res.status(201).json(item);
  });

  router.patch("/:id", async (req, res) => {
    const b = req.body || {};
    const data = {};
    if (b.checked !== undefined) data.checked = Boolean(b.checked);
    if (b.aisle !== undefined) data.aisle = b.aisle || null;
    if (b.store !== undefined) data.store = cleanStore(b.store);
    if (b.quantity !== undefined) data.quantity = b.quantity ? String(b.quantity).slice(0, 120) : null;
    const item = await prisma.shoppingItem.update({ where: { id: Number(req.params.id) }, data });
    if (b.store !== undefined) await learnPref(prisma, item.name, { store: data.store });
    res.json(item);
  });

  router.post("/bulk", async (req, res) => {
    const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 200)
      .filter((i) => String(i?.name || "").trim());
    const addedById = Number(req.body?.actorId) || null;
    const prefs = await prefsFor(prisma, items.map((i) => String(i.name)));
    if (items.length) {
      await prisma.shoppingItem.createMany({
        data: items.map((i, n) => ({
          name: nice(String(i.name).trim().slice(0, 120)), quantity: i.qty ? String(i.qty).slice(0, 120) : null,
          store: cleanStore(i.store) || prefs.get(itemKey(i.name))?.store || null,
          recipeIds: Array.isArray(i.ids) ? i.ids.map(Number).filter(Number.isInteger) : [],
          aisle: i.aisle || null, note: i.for?.length ? i.for.join(", ").slice(0, 200) : null,
          addedById, position: n
        }))
      });
    }
    res.json({ ok: true, added: items.length });
  });
  /* Start again: empty the list and forget which dinners it was for. */
  router.delete("/", async (_req, res) => {
    const { count } = await prisma.shoppingItem.deleteMany({});
    await prisma.familySetting.updateMany({ where: { id: 1 }, data: { listFrom: null, listTo: null, listRecipeIds: [] } });
    res.json({ ok: true, removed: count });
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

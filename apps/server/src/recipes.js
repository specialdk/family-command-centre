import { Router } from "express";

/* Recipes: the family's library, and how they feel about each one.

   Every recipe carries a family score - thumbs up minus thumbs down. Two
   or more net thumbs down and it moves to "Not for us": still there, never
   deleted, but no longer suggested when planning the week. */

export const NOT_FOR_US = -2;

export function createRecipes({ prisma }) {
  const router = Router();

  const shape = (r, viewerId) => {
    const up = r.ratings.filter((x) => x.value > 0);
    const down = r.ratings.filter((x) => x.value < 0);
    return {
      id: r.id, title: r.title, summary: r.summary, serves: r.serves,
      prepMins: r.prepMins, cookMins: r.cookMins, glutenFree: r.glutenFree,
      vegetarian: r.vegetarian, tags: r.tags, source: r.source,
      up: up.length, down: down.length, score: up.length - down.length,
      upBy: up.map((x) => x.memberId), downBy: down.map((x) => x.memberId),
      mine: r.ratings.find((x) => x.memberId === viewerId)?.value || 0,
    };
  };

  router.get("/", async (req, res) => {
    const viewerId = Number(req.query.viewer) || null;
    const all = await prisma.recipe.findMany({ include: { ratings: true }, orderBy: { title: "asc" } });
    res.json(all.map((r) => shape(r, viewerId)));
  });

  router.get("/:id", async (req, res) => {
    const r = await prisma.recipe.findUnique({ where: { id: Number(req.params.id) }, include: { ratings: true } });
    if (!r) return res.status(404).json({ error: "That recipe isn't here." });
    res.json({ ...shape(r, Number(req.query.viewer) || null), ingredients: r.ingredients, method: r.method });
  });

  /* value 1 = thumbs up, -1 = thumbs down, 0 = take my vote back. */
  router.post("/:id/rate", async (req, res) => {
    const recipeId = Number(req.params.id);
    const memberId = Number(req.body?.memberId);
    const value = Math.sign(Number(req.body?.value) || 0);
    if (!Number.isInteger(memberId)) return res.status(400).json({ error: "Choose who you are in Viewing as first." });
    if (value === 0) {
      await prisma.recipeRating.deleteMany({ where: { recipeId, memberId } });
    } else {
      await prisma.recipeRating.upsert({
        where: { recipeId_memberId: { recipeId, memberId } },
        create: { recipeId, memberId, value },
        update: { value }
      });
    }
    const r = await prisma.recipe.findUnique({ where: { id: recipeId }, include: { ratings: true } });
    res.json(shape(r, memberId));
  });

  return { router };
}

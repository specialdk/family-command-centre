import { Router } from "express";

/* Recipes: the family's library, and how they feel about each one.

   Every recipe carries a family score - thumbs up minus thumbs down. Two
   or more net thumbs down and it moves to "Not for us": still there, never
   deleted, but no longer suggested when planning the week. */

export const NOT_FOR_US = -2;

/* Pictures come from OpenAI's image model, through the same key as Jade.
   The model name is a setting because image model names move quickly. */
const IMAGE_MODEL = process.env.RECIPE_IMAGE_MODEL || "gpt-image-2";
const API_KEY = process.env.OPENAI_API_KEY || null;
const NO_IMAGE = { imageData: true };

function promptFor(r) {
  return [
    `An appetising, realistic food photograph of ${r.title}: ${r.summary || ""}`,
    "A home-cooked Australian family dinner, plated simply and served on a wooden kitchen table,",
    "soft natural daylight, shot from a slight angle, shallow depth of field.",
    "Just the food - no people, no hands, no text, no logos, no watermarks."
  ].join(" ");
}

export function createRecipes({ prisma }) {
  const router = Router();

  const shape = (r, viewerId) => {
    const up = r.ratings.filter((x) => x.value > 0);
    const down = r.ratings.filter((x) => x.value < 0);
    return {
      id: r.id, title: r.title, summary: r.summary, serves: r.serves,
      prepMins: r.prepMins, cookMins: r.cookMins, glutenFree: r.glutenFree,
      vegetarian: r.vegetarian, tags: r.tags, source: r.source,
      hasImage: !!r.imageAt, imageAt: r.imageAt,
      up: up.length, down: down.length, score: up.length - down.length,
      upBy: up.map((x) => x.memberId), downBy: down.map((x) => x.memberId),
      mine: r.ratings.find((x) => x.memberId === viewerId)?.value || 0,
    };
  };

  router.get("/", async (req, res) => {
    const viewerId = Number(req.query.viewer) || null;
    const all = await prisma.recipe.findMany({ include: { ratings: true }, omit: NO_IMAGE, orderBy: { title: "asc" } });
    res.json(all.map((r) => shape(r, viewerId)));
  });

  // ------------------------------------------------------------ pictures --

  /* Generate (or replace) one recipe's picture. Takes roughly 15-40 seconds;
     the caller waits. Returns the provider's own error if it fails, so a
     wrong model name or a spent key says so instead of failing quietly. */
  async function makeImage(id) {
    if (!API_KEY) throw new Error("OPENAI_API_KEY is not set on the server.");
    const r = await prisma.recipe.findUnique({ where: { id }, omit: NO_IMAGE });
    if (!r) throw new Error("That recipe isn't here.");
    const started = Date.now();
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IMAGE_MODEL, prompt: promptFor(r), n: 1,
        size: "1024x1024", quality: "medium", output_format: "webp"
      })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.data?.[0]?.b64_json) {
      throw new Error(String(data?.error?.message || `Image service answered ${resp.status}`).slice(0, 200));
    }
    const bytes = Buffer.from(data.data[0].b64_json, "base64");
    await prisma.recipe.update({ where: { id }, data: { imageData: bytes, imageType: "image/webp", imageAt: new Date() } });
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(JSON.stringify({ event: "recipe.image", id, title: r.title, secs, kb: Math.round(bytes.length / 1024) }));
    return { ok: true, secs, kb: Math.round(bytes.length / 1024) };
  }

  router.get("/:id/image", async (req, res) => {
    const r = await prisma.recipe.findUnique({ where: { id: Number(req.params.id) }, select: { imageData: true, imageType: true } });
    if (!r?.imageData) return res.status(404).end();
    // The URL carries ?v=<imageAt>, so a new picture is a new URL - safe to cache hard.
    res.set("Content-Type", r.imageType || "image/webp").set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(Buffer.from(r.imageData));
  });

  router.post("/:id/image", async (req, res) => {
    try { res.json(await makeImage(Number(req.params.id))); }
    catch (e) { console.error("recipe image failed:", e.message); res.status(502).json({ error: e.message }); }
  });

  /* Fill in every missing picture in the background, three at a time. */
  const job = { running: false, done: 0, failed: 0, total: 0, lastError: null };
  router.get("/images/status", async (_req, res) => {
    const [total, withImage] = await Promise.all([
      prisma.recipe.count(), prisma.recipe.count({ where: { imageAt: { not: null } } })
    ]);
    res.json({ total, withImage, job });
  });
  router.post("/images/missing", async (req, res) => {
    if (job.running) return res.json({ started: false, job });
    const limit = Math.min(Math.max(Number(req.body?.limit) || 100, 1), 100);
    const ids = (await prisma.recipe.findMany({ where: { imageAt: null }, select: { id: true }, orderBy: { title: "asc" }, take: limit })).map((r) => r.id);
    Object.assign(job, { running: true, done: 0, failed: 0, total: ids.length, lastError: null });
    res.json({ started: true, job });
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try { await makeImage(id); job.done++; }
        catch (e) { job.failed++; job.lastError = e.message; console.error("recipe image failed:", id, e.message); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    job.running = false;
  });

  router.get("/:id", async (req, res) => {
    const r = await prisma.recipe.findUnique({ where: { id: Number(req.params.id) }, include: { ratings: true }, omit: NO_IMAGE });
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
    const r = await prisma.recipe.findUnique({ where: { id: recipeId }, include: { ratings: true }, omit: NO_IMAGE });
    res.json(shape(r, memberId));
  });

  return { router };
}

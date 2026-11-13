import { Router } from "express";
import OpenAI from "openai";

/* Ideas - things the family half-decides, mostly talked out to Jade.

   An idea is a card: a title, a line of about fifteen words for the board,
   and a few sentences for when it is opened. Underneath sits its history -
   every conversation with Jade (what was actually said) and every quick
   addition. Each time something is added, the title, line and summary are
   rewritten so the card always reads as where the idea is now.

   Rules agreed with the family:
   - Visibility per idea: FAMILY, PARENTS, or PRIVATE (just the author), so a
     birthday surprise never shows on the birthday person's screen.
   - Anyone who can see an idea can add to it.
   - Only the person who raised an idea can turn it into tasks, and the tasks
     still come as an approval card.
   - One conversation is one idea, unless the person asks for it to be split. */

const MODEL = process.env.JADE_MODEL || "gpt-6.1-sol";
const API_KEY = process.env.OPENAI_API_KEY || null;

export const IDEA_TOOLS = [
  {
    name: "save_idea",
    description:
      "Save a new idea to the family's ideas board, once the person has finished telling you " +
      "it (they say \"that's it\", \"save that\" or similar). Saved straight away - it is their own. " +
      "Only save several ideas from one conversation if they ask you to split it; then call this " +
      "once per idea.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A few words, e.g. \"Gold Coast trip in the school holidays\"" },
        short_line: { type: "string", description: "About fifteen words: what the board shows" },
        summary: { type: "string", description: "Three to five sentences covering everything said" },
        visibility: { type: "string", enum: ["family", "parents", "private"],
          description: "Only if they say so. private = just them, e.g. a surprise. Default family." }
      },
      required: ["title", "short_line", "summary"]
    }
  },
  {
    name: "update_idea",
    description:
      "Add to an idea that is already on the board, or record where a conversation about it got " +
      "to. Rewrite the title, short line and summary so they cover EVERYTHING so far - the old " +
      "summary plus what is new - not just the addition. Saved straight away.",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Enough of its title to find it. Omit if you were opened on this idea." },
        title: { type: "string", description: "Only if the idea has changed enough to need a new name" },
        short_line: { type: "string", description: "About fifteen words, rewritten" },
        summary: { type: "string", description: "Three to five sentences, rewritten to cover everything" },
        note: { type: "string", description: "What was just added, in one line" }
      },
      required: ["short_line", "summary"]
    }
  },
  {
    name: "ideas_to_tasks",
    description:
      "Propose turning an idea into tasks. Only for an idea the speaker raised themselves. This " +
      "does not create anything - a person sees the list and approves it.",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", description: "Enough of its title to find it. Omit if you were opened on this idea." },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              member: { type: "string", description: "First name of who does it; omit if unallocated" },
              date: { type: "string", description: "Optional YYYY-MM-DD" },
              time: { type: "string", description: "Optional HH:mm, 24 hour" }
            },
            required: ["title"]
          }
        }
      },
      required: ["tasks"]
    }
  }
];
export const IDEA_NAMES = new Set(IDEA_TOOLS.map((t) => t.name));

const STATUS_WORD = { NEW: "new", DISCUSSING: "being talked about", PLANNED: "planned", DONE: "done", PARKED: "parked" };

/* Local time to UTC for the family's zone - the same two-pass method Jade uses. */
function offsetMs(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime();
}
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr || "09:00").split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

export function visibleTo(idea, member) {
  if (!idea) return false;
  if (idea.visibility === "FAMILY") return true;
  if (!member) return false;
  if (idea.authorId === member.id) return true;
  return idea.visibility === "PARENTS" && member.role === "PARENT";
}

const clip = (s, n) => String(s || "").trim().slice(0, n);
const VIS = { family: "FAMILY", parents: "PARENTS", private: "PRIVATE" };

export function createIdeas({ prisma, familyTz, openai }) {
  const client = openai || (API_KEY ? new OpenAI({ apiKey: API_KEY }) : null);
  const firstName = (s) => String(s || "").trim().split(/\s+/)[0]?.toLowerCase() || "";

  async function member(id) {
    const n = Number(id);
    return Number.isInteger(n) ? prisma.familyMember.findUnique({ where: { id: n } }) : null;
  }

  async function visibleIdeas(viewer) {
    const all = await prisma.idea.findMany({
      include: { author: true, _count: { select: { tasks: true, entries: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200
    });
    return all.filter((i) => visibleTo(i, viewer));
  }

  /* Finds an idea by a few words of its title, among those the speaker can see. */
  async function findIdea(words, viewer, fallbackId) {
    const pool = await visibleIdeas(viewer);
    if (!String(words || "").trim()) {
      const hit = pool.find((i) => i.id === Number(fallbackId));
      return { hit: hit || null, many: [] };
    }
    const needle = String(words).trim().toLowerCase();
    const exact = pool.filter((i) => i.title.toLowerCase() === needle);
    if (exact.length === 1) return { hit: exact[0], many: [] };
    const partial = pool.filter((i) => i.title.toLowerCase().includes(needle));
    if (partial.length === 1) return { hit: partial[0], many: [] };
    if (partial.length > 1) return { hit: null, many: partial };
    // Loose match on words, for "the Gold Coast one" against "Gold Coast trip in the holidays".
    const want = needle.split(/\W+/).filter((w) => w.length > 2);
    const scored = pool.map((i) => ({ i, s: want.filter((w) => i.title.toLowerCase().includes(w)).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) return { hit: scored[0].i, many: [] };
    return { hit: null, many: scored.map((x) => x.i) };
  }

  // ------------------------------------------------------------ for Jade --

  /* The ideas this person can see, for Jade's picture of the family. */
  async function listForPrompt(viewer) {
    const ideas = (await visibleIdeas(viewer)).filter((i) => !["DONE", "PARKED"].includes(i.status)).slice(0, 20);
    if (!ideas.length) return "- none yet";
    return ideas.map((i) =>
      `- "${i.title}" (${STATUS_WORD[i.status]}, raised by ${i.author?.name || "someone"}) - ${i.shortLine}`
    ).join("\n");
  }

  /* What Jade is told when opened on the ideas board. */
  async function aboutLine(idea, viewer) {
    if (!idea) return null;
    if (idea.mode === "new") {
      return [
        "They opened you to tell you an idea. Let them talk - this is a brain-dump, not an interview.",
        "Ask at most one or two short questions to draw it out (roughly when, who is involved).",
        "Do NOT save until they say they are done (\"that's it\", \"save that\", \"that's the idea\").",
        "Then call save_idea once. Only split it into several ideas if they ask you to.",
        "After saving, confirm in one short sentence and stop."
      ].join(" ");
    }
    const i = await prisma.idea.findUnique({
      where: { id: Number(idea.id) },
      include: { author: true, entries: { orderBy: { createdAt: "desc" }, take: 6, include: { author: true } } }
    });
    if (!i || !visibleTo(i, viewer)) return null;
    const history = i.entries.reverse().map((e) =>
      `  ${e.kind === "NOTE" ? "Note" : "Earlier conversation"} from ${e.author?.name || "someone"}: ${clip(e.text, 600)}`
    ).join("\n");
    return [
      `They opened you on the idea "${i.title}" (raised by ${i.author?.name || "someone"}, ${STATUS_WORD[i.status]}).`,
      `Where it is now: ${i.summary || i.shortLine}`,
      history ? `History:\n${history}` : "",
      "Open with a one-sentence recap of where it got to, then ask what they want to add.",
      "When they are done, call update_idea with the title, short line and summary rewritten to",
      "cover everything so far. If they ask to turn it into tasks, use ideas_to_tasks."
    ].filter(Boolean).join("\n");
  }

  /* Returns { output, applied?, proposal? } for Jade. */
  async function runTool(name, args, { speaker, transcript, aboutIdeaId }) {
    if (!speaker) {
      return { output: "You do not know who is speaking, so you cannot save ideas. Ask them to choose who they are in \"Viewing as\" first." };
    }

    if (name === "save_idea") {
      if (!String(args.title || "").trim() || !String(args.short_line || "").trim()) {
        return { output: "Not saved: give it a title and a short line." };
      }
      const idea = await prisma.idea.create({
        data: {
          title: clip(args.title, 120),
          shortLine: clip(args.short_line, 200),
          summary: clip(args.summary, 2000) || null,
          visibility: VIS[String(args.visibility || "").toLowerCase()] || "FAMILY",
          authorId: speaker.id,
          entries: {
            create: {
              kind: transcript ? "CONVERSATION" : "NOTE",
              authorId: speaker.id,
              text: clip(transcript || args.summary || args.short_line, 20000)
            }
          }
        }
      });
      return {
        output: `Saved "${idea.title}" to the ideas board. Confirm it in a few words.`,
        applied: { kind: "idea", ideaId: idea.id, title: idea.title }
      };
    }

    const { hit, many } = await findIdea(args.idea, speaker, aboutIdeaId);
    if (!hit) {
      return {
        output: many.length
          ? `More than one idea matches: ${many.slice(0, 4).map((i) => i.title).join(", ")}. Ask which one.`
          : "There is no idea by that name on the board. Ask them which one they mean, or offer to save it as a new idea."
      };
    }

    if (name === "update_idea") {
      await prisma.idea.update({
        where: { id: hit.id },
        data: {
          ...(String(args.title || "").trim() ? { title: clip(args.title, 120) } : {}),
          shortLine: clip(args.short_line, 200) || hit.shortLine,
          summary: clip(args.summary, 2000) || hit.summary,
          ...(hit.status === "NEW" ? { status: "DISCUSSING" } : {}),
          entries: {
            create: {
              kind: transcript ? "CONVERSATION" : "NOTE",
              authorId: speaker.id,
              text: clip(transcript || args.note || args.summary, 20000)
            }
          }
        }
      });
      return {
        output: `Updated "${hit.title}". Confirm it in a few words.`,
        applied: { kind: "idea", ideaId: hit.id, title: hit.title }
      };
    }

    if (name === "ideas_to_tasks") {
      if (hit.authorId !== speaker.id) {
        return { output: `Only ${hit.author?.name || "the person who raised it"} can turn "${hit.title}" into tasks. Say so.` };
      }
      const tasks = (Array.isArray(args.tasks) ? args.tasks : [])
        .filter((t) => String(t?.title || "").trim()).slice(0, 15);
      if (!tasks.length) return { output: "Not drafted: no tasks given. Work out the tasks with them first." };
      return {
        output: "Drafted, and shown on screen. Nothing has been created yet - they have to tap to approve it. Tell them that.",
        proposal: {
          tool: "ideas_to_tasks",
          input: { ideaId: hit.id, tasks },
          kicker: `Tasks from "${hit.title}"`,
          title: `${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
          detail: tasks.map((t) => [t.title, t.member, t.date, t.time].filter(Boolean).join(" · ")).join("\n")
        }
      };
    }

    return { output: `Jade has no tool called ${name}.` };
  }

  /* The approval tap for ideas_to_tasks. */
  async function applyTasks(input, actorId) {
    const idea = await prisma.idea.findUnique({ where: { id: Number(input?.ideaId) } });
    if (!idea) return { ok: false, error: "That idea is no longer there." };
    if (idea.authorId !== Number(actorId)) return { ok: false, error: "Only the person who raised the idea can turn it into tasks." };
    const members = await prisma.familyMember.findMany();
    const list = await prisma.taskList.findFirst({ where: { name: "Unallocated" } });
    const created = [];
    for (const t of (input.tasks || []).slice(0, 15)) {
      const who = members.find((m) => firstName(m.name) === firstName(t.member));
      created.push(await prisma.task.create({
        data: {
          title: clip(t.title, 200),
          listId: list?.id ?? null,
          memberId: who?.id ?? null,
          scheduledFor: t.date ? zonedToUtc(t.date, t.time || "09:00", familyTz) : null,
          ideaId: idea.id
        }
      }));
    }
    await prisma.idea.update({ where: { id: idea.id }, data: { status: "PLANNED" } });
    return { ok: true, applied: "ideas_to_tasks", created: created.length };
  }

  /* A typed note from the board. Jade is not in the room, so the summary is
     rewritten here - and if that fails, the note is still kept. */
  async function resummarise(id) {
    if (!client) return;
    const i = await prisma.idea.findUnique({
      where: { id }, include: { entries: { orderBy: { createdAt: "asc" }, include: { author: true } } }
    });
    if (!i) return;
    const history = i.entries.map((e) => `${e.author?.name || "Someone"} (${e.kind.toLowerCase()}): ${clip(e.text, 3000)}`).join("\n\n");
    try {
      const reply = await client.responses.create({
        model: MODEL,
        instructions:
          "You keep a family's ideas board tidy. Given an idea's current card and its full history, " +
          "rewrite the card so it covers everything so far. Reply with only JSON: " +
          "{\"title\": a few words, \"short_line\": about fifteen words, \"summary\": three to five sentences}. " +
          "Australian spelling. Never use he, she, his or her about family members - use names.",
        input: `Current title: ${i.title}\nCurrent line: ${i.shortLine}\nCurrent summary: ${i.summary || ""}\n\nHistory:\n${history}`
      });
      const text = String(reply.output_text || "").replace(/^```(json)?|```$/g, "").trim();
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      await prisma.idea.update({
        where: { id },
        data: {
          title: clip(j.title, 120) || i.title,
          shortLine: clip(j.short_line, 200) || i.shortLine,
          summary: clip(j.summary, 2000) || i.summary
        }
      });
    } catch (e) {
      console.error("idea resummarise failed:", e?.message || e);
    }
  }

  // -------------------------------------------------------------- routes --
  const router = Router();

  router.get("/", async (req, res) => {
    const viewer = await member(req.query.viewer);
    const ideas = await visibleIdeas(viewer);
    res.json(ideas.map((i) => ({
      id: i.id, title: i.title, shortLine: i.shortLine, status: i.status, visibility: i.visibility,
      authorId: i.authorId, author: i.author ? { id: i.author.id, name: i.author.name, initials: i.author.initials } : null,
      taskCount: i._count.tasks, entryCount: i._count.entries, updatedAt: i.updatedAt, createdAt: i.createdAt
    })));
  });

  router.get("/:id", async (req, res) => {
    const viewer = await member(req.query.viewer);
    const i = await prisma.idea.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        author: true,
        entries: { orderBy: { createdAt: "desc" }, include: { author: true } },
        tasks: { include: { member: true }, orderBy: { createdAt: "asc" } }
      }
    });
    if (!i || !visibleTo(i, viewer)) return res.status(404).json({ error: "That idea isn't here." });
    res.json(i);
  });

  router.patch("/:id", async (req, res) => {
    const actor = await member(req.body?.actorId);
    const i = await prisma.idea.findUnique({ where: { id: Number(req.params.id) } });
    if (!i || !visibleTo(i, actor)) return res.status(404).json({ error: "That idea isn't here." });
    const isAuthor = actor?.id === i.authorId;
    const data = {};
    if (req.body?.status !== undefined) {
      if (!isAuthor && actor?.role !== "PARENT") return res.status(403).json({ error: "Only the person who raised it, or a parent, can change its status." });
      if (!STATUS_WORD[req.body.status]) return res.status(400).json({ error: "Unknown status" });
      data.status = req.body.status;
    }
    if (req.body?.visibility !== undefined) {
      if (!isAuthor) return res.status(403).json({ error: "Only the person who raised it can change who sees it." });
      if (!["FAMILY", "PARENTS", "PRIVATE"].includes(req.body.visibility)) return res.status(400).json({ error: "Unknown visibility" });
      data.visibility = req.body.visibility;
    }
    res.json(await prisma.idea.update({ where: { id: i.id }, data }));
  });

  router.post("/:id/notes", async (req, res) => {
    const actor = await member(req.body?.actorId);
    const text = clip(req.body?.text, 4000);
    if (!text) return res.status(400).json({ error: "Write something first." });
    const i = await prisma.idea.findUnique({ where: { id: Number(req.params.id) } });
    if (!i || !visibleTo(i, actor)) return res.status(404).json({ error: "That idea isn't here." });
    await prisma.ideaEntry.create({ data: { ideaId: i.id, kind: "NOTE", authorId: actor?.id ?? null, text } });
    if (i.status === "NEW") await prisma.idea.update({ where: { id: i.id }, data: { status: "DISCUSSING" } });
    await resummarise(i.id);
    res.json({ ok: true });
  });

  router.delete("/:id", async (req, res) => {
    const actor = await member(req.body?.actorId);
    const i = await prisma.idea.findUnique({ where: { id: Number(req.params.id) } });
    if (!i || !visibleTo(i, actor)) return res.status(404).json({ error: "That idea isn't here." });
    if (actor?.id !== i.authorId && actor?.role !== "PARENT") {
      return res.status(403).json({ error: "Only the person who raised it, or a parent, can delete it." });
    }
    await prisma.idea.delete({ where: { id: i.id } });
    res.json({ ok: true });
  });

  return { router, runTool, applyTasks, listForPrompt, aboutLine };
}

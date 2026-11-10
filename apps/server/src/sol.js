import express from "express";
import Anthropic from "@anthropic-ai/sdk";

/* Sol — the family's assistant.

   The shape of this file follows one rule: Sol answers on its own, but it
   never changes anything on its own. Reading tools run inside the model loop
   so a question is answered in a single turn. Writing tools do not run at
   all - they come back as a proposal for a person to approve, which is what
   Rhian's own `.proposal-card` was designed for. Approving is a second,
   deliberate request to /api/sol/apply.

   That means a mistake by the model is a card someone declines, not a notice
   sent to four people or an event moved out from under them. */

const MODEL = process.env.SOL_MODEL || "claude-sonnet-5-5";
/* The SDK looks for ANTHROPIC_API_KEY; ANTHROPIC_KEY is accepted so the
   variable name in Railway and the code cannot drift apart. */
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || null;

const READ_TOOLS = [
  {
    name: "check_calendar",
    description:
      "Look at what is on the family calendar between two dates. Use this for any question " +
      "about what is happening, who is busy, or when something is. Dates are plain " +
      "YYYY-MM-DD in the family's own timezone.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "First day to include, YYYY-MM-DD" },
        to: { type: "string", description: "Last day to include, YYYY-MM-DD" },
        member: { type: "string", description: "Optional first name to limit it to one person" }
      },
      required: ["from", "to"]
    }
  },
  {
    name: "list_tasks",
    description:
      "List the family's tasks. Use this for questions about what needs doing, what is " +
      "outstanding, or what someone has on.",
    input_schema: {
      type: "object",
      properties: {
        member: { type: "string", description: "Optional first name to limit it to one person" },
        status: { type: "string", enum: ["OPEN", "DONE", "ALL"], description: "Defaults to OPEN" }
      }
    }
  }
];

const WRITE_TOOLS = [
  {
    name: "add_task",
    description:
      "Propose adding a task to the family's list. This does not add it - a person sees " +
      "the proposal and approves it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        member: { type: "string", description: "Whose task it is; omit for unallocated" },
        due_date: { type: "string", description: "Optional YYYY-MM-DD" },
        notes: { type: "string" }
      },
      required: ["title"]
    }
  },
  {
    name: "schedule_event",
    description:
      "Propose putting something on the calendar at a time. This does not create it - a " +
      "person sees the proposal and approves it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD in the family's timezone" },
        start_time: { type: "string", description: "HH:mm, 24 hour. Omit for an all-day item." },
        duration_minutes: { type: "number", description: "Defaults to 60" },
        member: { type: "string", description: "Whose event it is; omit for a family event" },
        location: { type: "string" }
      },
      required: ["title", "date"]
    }
  },
  {
    name: "notify_family",
    description:
      "Propose telling the whole family something. This does not send it - a person reads " +
      "the draft and approves it. Use sparingly: it reaches everyone.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One line, the thing itself" },
        body: { type: "string", description: "Optional detail" }
      },
      required: ["title"]
    }
  }
];

const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

/* ------------------------------------------------------------ timezone ---
   The family thinks in local time; the database stores UTC. Working out the
   offset from Intl rather than the server's own clock is what stops a
   7:30pm dinner arriving as 6am, which is exactly what the seed did before
   it was fixed. Two passes because the offset at the naive instant can be
   the wrong side of a daylight-saving change. */
function offsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - date.getTime();
}

function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const [hh, mm] = String(timeStr || "09:00").split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

const todayIn = (tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD

export function createSolRouter({ prisma, notify, whenLabel, familyTz, anthropic }) {
  const router = express.Router();
  /* `anthropic` is injectable so the tests can run the whole route - tools,
     proposals, applying - without a key or a network call. */
  const client = anthropic || (API_KEY ? new Anthropic({ apiKey: API_KEY }) : null);

  const firstName = (s) => String(s || "").trim().split(/\s+/)[0]?.toLowerCase() || "";

  /* Always a full date, never a bare weekday. The app's own whenLabel says
     "Tue 7:30 pm", which is right for a person looking at this week's screen
     but wrong for a model: it then has to work out which Tuesday, and that
     is exactly how a Friday task gets reported as due tomorrow. */
  const stamp = (d, allDay) => new Intl.DateTimeFormat("en-AU", {
    timeZone: familyTz, weekday: "short", day: "numeric", month: "short",
    ...(allDay ? {} : { hour: "numeric", minute: "2-digit" })
  }).format(d);

  /* due and scheduled are different things and the family treats them that
     way - "do it Saturday morning" is not "due Saturday". Say which is which
     every time, so Sol never has to guess. */
  const taskWhen = (t) => [
    t.scheduledFor ? `on the calendar ${stamp(t.scheduledFor, false)}` : null,
    t.dueAt ? `due ${stamp(t.dueAt, true)}` : null
  ].filter(Boolean).join(", ") || "no time yet";

  async function findMember(name) {
    if (!name) return null;
    const all = await prisma.familyMember.findMany();
    const want = firstName(name);
    return all.find((m) => firstName(m.name) === want) || null;
  }

  /* What Sol is told about the family before it answers anything. Deliberately
     small: a week of calendar and the open tasks, not the whole database. The
     cost of every single turn is set here, so it stays a summary. */
  async function snapshot() {
    const today = todayIn(familyTz);
    const from = zonedToUtc(today, "00:00", familyTz);
    const to = new Date(from.getTime() + 7 * 86400000);

    const [members, events, tasks] = await Promise.all([
      prisma.familyMember.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      prisma.event.findMany({
        where: { cancelled: false, startsAt: { gte: from, lt: to } },
        include: { member: true },
        orderBy: { startsAt: "asc" },
        take: 40
      }),
      prisma.task.findMany({
        where: { status: "OPEN" },
        include: { member: true },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 30
      })
    ]);

    /* A task with a scheduledFor is drawn on the calendar as a TO DO block,
       so it is part of the week whether or not it is also due then. Leaving
       them out of the diary was why Sol answered about due dates when it was
       asked what was on. */
    const scheduled = tasks.filter((t) =>
      t.scheduledFor && t.scheduledFor >= from && t.scheduledFor < to);

    const who = members.map((m) => `${m.name} (${m.role.toLowerCase()})`).join(", ");
    const week = [
      ...events.map((e) => ({
        at: e.startsAt,
        line: `- ${stamp(e.startsAt, e.allDay)} — ${e.title}` +
              `${e.member ? ` (${e.member.name})` : " (family)"}` +
              `${e.location ? ` at ${e.location}` : ""}`
      })),
      ...scheduled.map((t) => ({
        at: t.scheduledFor,
        line: `- ${stamp(t.scheduledFor, false)} — ${t.title} [to do]` +
              `${t.member ? ` (${t.member.name})` : " (unallocated)"}`
      }))
    ].sort((a, b) => a.at - b.at);

    const diary = week.length ? week.map((w) => w.line).join("\n") : "- nothing on";
    const todo = tasks.length
      ? tasks.map((t) =>
          `- ${t.title}${t.member ? ` (${t.member.name})` : " (unallocated)"} — ${taskWhen(t)}`
        ).join("\n")
      : "- nothing open";

    return { today, who, diary, todo };
  }

  function systemPrompt(s) {
    return [
      "You are Sol, the assistant inside a family's command centre app.",
      `Today is ${s.today} and the family lives in ${familyTz}.`,
      `The family: ${s.who}.`,
      "",
      "The next seven days:",
      s.diary,
      "",
      "Open tasks:",
      s.todo,
      "",
      "How you work:",
      "- Answer from what you have above when it is enough. Use check_calendar or",
      "  list_tasks when you need more than a week, or a specific person's detail.",
      "- You cannot change anything yourself. add_task, schedule_event and",
      "  notify_family propose a change for a person to approve. When you use one,",
      "  say plainly what you have drafted and that it needs their go-ahead.",
      "- Never claim something has been added, scheduled or sent. It has not been.",
      "- \"Due\" and \"on the calendar\" are different. A task can be scheduled for",
      "  Friday and due Wednesday. Say which one you mean, and never turn a due",
      "  date into a time something is happening.",
      "- Every date above is written out. Use the dates as given rather than",
      "  working out weekdays yourself.",
      "- Be brief. Two or three sentences. This is read on a phone, often one-handed.",
      "- Australian spelling and 24-hour-free plain times: say 7:30pm, not 19:30."
    ].join("\n");
  }

  async function runTool(name, input) {
    if (name === "check_calendar") {
      const member = input.member ? await findMember(input.member) : null;
      if (input.member && !member) return `There is nobody called ${input.member} in this family.`;
      const from = zonedToUtc(input.from, "00:00", familyTz);
      const to = new Date(zonedToUtc(input.to, "00:00", familyTz).getTime() + 86400000);
      const events = await prisma.event.findMany({
        where: {
          cancelled: false, startsAt: { gte: from, lt: to },
          ...(member ? { memberId: member.id } : {})
        },
        include: { member: true },
        orderBy: { startsAt: "asc" },
        take: 60
      });
      if (!events.length) return "Nothing on in that period.";
      return events.map((e) =>
        `${stamp(e.startsAt, e.allDay)} — ${e.title}` +
        `${e.member ? ` (${e.member.name})` : " (family)"}${e.location ? ` at ${e.location}` : ""}`
      ).join("\n");
    }

    if (name === "list_tasks") {
      const member = input.member ? await findMember(input.member) : null;
      if (input.member && !member) return `There is nobody called ${input.member} in this family.`;
      const status = input.status && input.status !== "ALL" ? input.status : null;
      const tasks = await prisma.task.findMany({
        where: { ...(status ? { status } : {}), ...(member ? { memberId: member.id } : {}) },
        include: { member: true, list: true },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        take: 60
      });
      if (!tasks.length) return "No tasks match that.";
      return tasks.map((t) =>
        `${t.status === "DONE" ? "[done] " : ""}${t.title}` +
        `${t.member ? ` (${t.member.name})` : " (unallocated)"} — ${taskWhen(t)}`
      ).join("\n");
    }

    return `Sol has no tool called ${name}.`;
  }

  /* Turned into the three lines of Rhian's proposal card: the uppercase
     kicker, the thing itself, and the detail underneath. */
  function describeProposal(tool, input) {
    if (tool === "add_task") {
      return {
        kicker: "New task",
        title: input.title,
        detail: [input.member ? `for ${input.member}` : "unallocated",
                 input.due_date ? `due ${input.due_date}` : null].filter(Boolean).join(" · ")
      };
    }
    if (tool === "schedule_event") {
      const when = input.start_time ? `${input.date} at ${input.start_time}` : `${input.date}, all day`;
      return {
        kicker: "New calendar item",
        title: input.title,
        detail: [when, input.member ? input.member : "family",
                 input.location || null].filter(Boolean).join(" · ")
      };
    }
    if (tool === "notify_family") {
      return { kicker: "Notice to the whole family", title: input.title, detail: input.body || "" };
    }
    return { kicker: "Proposal", title: tool, detail: "" };
  }

  // ------------------------------------------------------------------ ask --
  router.post("/", async (req, res) => {
    if (!client) {
      return res.status(503).json({
        error: "Sol is not connected yet — ANTHROPIC_API_KEY is not set on the server."
      });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Say something to Sol first." });

    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
    const messages = [...history, { role: "user", content: message }];

    try {
      const s = await snapshot();
      const system = systemPrompt(s);
      let proposal = null;
      let said = "";

      /* Four passes is plenty: read, read again, then answer. A write tool
         ends the loop immediately, because nothing is going to run. */
      for (let pass = 0; pass < 4; pass++) {
        const reply = await client.messages.create({
          model: MODEL,
          max_tokens: 700,
          system,
          tools: [...READ_TOOLS, ...WRITE_TOOLS],
          messages
        });

        const text = reply.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        if (text) said = text;

        const calls = reply.content.filter((b) => b.type === "tool_use");
        if (!calls.length) break;

        const write = calls.find((c) => WRITE_NAMES.has(c.name));
        if (write) {
          proposal = { tool: write.name, input: write.input, ...describeProposal(write.name, write.input) };
          break;
        }

        messages.push({ role: "assistant", content: reply.content });
        messages.push({
          role: "user",
          content: await Promise.all(calls.map(async (c) => ({
            type: "tool_result",
            tool_use_id: c.id,
            content: await runTool(c.name, c.input || {})
          })))
        });
      }

      res.json({
        reply: said || (proposal ? "I've drafted that below — have a look before it goes anywhere." : "…"),
        proposal,
        history: [...messages.filter((m) => typeof m.content === "string"), ].slice(-8)
      });
    } catch (e) {
      console.error("Sol failed:", e.message);
      res.status(502).json({ error: "Sol could not answer just now." });
    }
  });

  // ---------------------------------------------------------------- apply --
  /* The only place a proposal becomes real. It takes the proposal back from
     the client rather than remembering it, which means the thing approved is
     the thing that was on screen. */
  router.post("/apply", async (req, res) => {
    const { tool, input } = req.body?.proposal || {};
    if (!tool || !input) return res.status(400).json({ error: "Nothing to apply." });
    const actorId = req.body?.memberId ? Number(req.body.memberId) : null;

    try {
      if (tool === "add_task") {
        const member = await findMember(input.member);
        const list = await prisma.taskList.findFirst({ where: { name: "Unallocated" } });
        const task = await prisma.task.create({
          data: {
            title: String(input.title).trim(),
            notes: input.notes ? String(input.notes) : null,
            listId: list?.id ?? null,
            memberId: member?.id ?? null,
            dueAt: input.due_date ? zonedToUtc(input.due_date, "09:00", familyTz) : null
          },
          include: { member: true, list: true }
        });
        await notify({
          title: `${task.title} was added to the list`,
          body: member ? `For ${member.name}. Added through Sol.` : "Added through Sol.",
          kind: "CHANGE", authorId: actorId, entity: "TASK", entityId: task.id
        });
        return res.json({ ok: true, applied: "add_task", task });
      }

      if (tool === "schedule_event") {
        const member = await findMember(input.member);
        const allDay = !input.start_time;
        const startsAt = zonedToUtc(input.date, input.start_time || "00:00", familyTz);
        const minutes = allDay ? 24 * 60 : Number(input.duration_minutes || 60);
        const calendar = await prisma.calendar.findFirst({
          where: member ? { memberId: member.id } : {},
          orderBy: { id: "asc" }
        });
        const event = await prisma.event.create({
          data: {
            title: String(input.title).trim(),
            startsAt,
            endsAt: new Date(startsAt.getTime() + minutes * 60000),
            allDay,
            location: input.location ? String(input.location) : null,
            memberId: member?.id ?? null,
            calendarId: calendar?.id ?? null,
            timeZone: familyTz
          },
          include: { member: true, calendar: true }
        });
        await notify({
          title: `${event.title} is on for ${whenLabel(event.startsAt, event.allDay)}`,
          body: member ? `${member.name}'s. Added through Sol.` : "Added through Sol.",
          kind: "CHANGE", authorId: actorId, entity: "EVENT", entityId: event.id
        });
        return res.json({ ok: true, applied: "schedule_event", event });
      }

      if (tool === "notify_family") {
        const notice = await notify({
          title: String(input.title).trim(),
          body: input.body ? String(input.body) : null,
          kind: "FAMILY_NOTICE", authorId: actorId
        });
        return res.json({ ok: true, applied: "notify_family", notice });
      }

      res.status(400).json({ error: `Sol cannot apply ${tool}.` });
    } catch (e) {
      console.error("Sol apply failed:", e.message);
      res.status(500).json({ error: "That could not be applied." });
    }
  });

  router.get("/status", (_req, res) =>
    res.json({ connected: !!client, model: client ? MODEL : null })
  );

  return router;
}

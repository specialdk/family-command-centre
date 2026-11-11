import express from "express";
import OpenAI from "openai";
import { reduceEvents, WITH_VISIBILITY } from "./visibility.js";

/* Jade — the family's assistant.

   The shape of this file follows one rule: Jade answers on its own, but it
   never changes anything on its own. Reading tools run inside the model loop
   so a question is answered in a single turn. Writing tools do not run at
   all - they come back as a proposal for a person to approve, which is what
   Rhian's own `.proposal-card` was designed for. Approving is a second,
   deliberate request to /api/jade/apply.

   That means a mistake by the model is a card someone declines, not a notice
   sent to four people or an event moved out from under them. */

/* OpenAI, because voice is the point of this app and the dialogue has to
   feel like one. The typed path lives here; the spoken path is a realtime
   session that calls the same tools on the same server, so the rules below
   hold whichever way someone asks.

   Model is configurable because model names move faster than this file. If
   a deploy starts answering 502, check /api/jade/status?probe=1 first - it
   makes one real call and hands back whatever the provider actually said. */
const MODEL = process.env.JADE_MODEL || "gpt-6.1-sol";
const API_KEY = process.env.OPENAI_API_KEY || null;

const READ_TOOLS = [
  {
    name: "check_calendar",
    description:
      "Look at what is on the family calendar between two dates. Use this for any question " +
      "about what is happening, who is busy, or when something is. Dates are plain " +
      "YYYY-MM-DD in the family's own timezone.",
    parameters: {
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
    parameters: {
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
    parameters: {
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
    parameters: {
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
    name: "reschedule_task",
    description:
      "Propose giving an existing task a time on the calendar, or moving the time it " +
      "already has. Use this when someone wants to move, reschedule or 'do it on' a task " +
      "that already exists, rather than adding a new one.",
    input_schema: {
      type: "object",
      properties: {
        task_title: { type: "string", description: "Enough of the existing task's title to find it" },
        date: { type: "string", description: "YYYY-MM-DD in the family's timezone" },
        start_time: { type: "string", description: "HH:mm, 24 hour" },
        duration_minutes: { type: "number", description: "Defaults to 30" }
      },
      required: ["task_title", "date"]
    }
  },
  {
    name: "move_event",
    description:
      "Propose moving an event that is already on the calendar to a different time, or " +
      "changing where it is. Use this rather than creating a second copy of something.",
    input_schema: {
      type: "object",
      properties: {
        event_title: { type: "string", description: "Enough of the existing event's title to find it" },
        date: { type: "string", description: "YYYY-MM-DD in the family's timezone" },
        start_time: { type: "string", description: "HH:mm, 24 hour. Omit to keep the time." },
        duration_minutes: { type: "number" },
        location: { type: "string", description: "Only if it is changing" }
      },
      required: ["event_title", "date"]
    }
  },
  {
    name: "notify_family",
    description:
      "Propose telling the whole family something. This does not send it - a person reads " +
      "the draft and approves it. Use sparingly: it reaches everyone.",
    parameters: {
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

/* A proposal with a missing field renders as "undefined, all day" on the
   card and then fails when someone taps it. The model should be asking the
   person instead, so a write with holes in it is handed straight back as a
   tool result naming what is missing. */
const REQUIRED = {
  add_task: ["title"],
  schedule_event: ["title", "date"],
  reschedule_task: ["task_title", "date"],
  move_event: ["event_title", "date"],
  notify_family: ["title"]
};
const missingFrom = (tool, args) =>
  (REQUIRED[tool] || []).filter((f) => !String(args?.[f] ?? "").trim());
const READ_NAMES = new Set(READ_TOOLS.map((t) => t.name));

/* Separate from the typed model: a realtime model is a different thing with
   its own names, and pinning them apart means a change to one cannot
   silently break the other. Voice is a matter of taste, so it is a setting -
   the current options are alloy, ash, ballad, coral, echo, sage, shimmer,
   verse, marin and cedar, and OpenAI recommends marin and cedar for quality.
   Their documentation says nothing about how any of them sound, so the only
   way to choose is to listen. */
const REALTIME_MODEL = process.env.JADE_REALTIME_MODEL || "gpt-realtime-2.1";
const REALTIME_VOICE = process.env.JADE_VOICE || "marin";

/* `strict: false` on purpose. Strict mode requires every property to be
   required and additionalProperties false; half of these are genuinely
   optional - a task may have no due date, an event no location - and
   forcing them would make the model invent values to satisfy a schema. */
const TOOL_BASE = [...READ_TOOLS, ...WRITE_TOOLS].map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  parameters: t.parameters
}));

/* The typed path takes `strict`; the realtime session rejects it outright -
   "Unknown parameter: session.tools[0].strict". Same tools, two shapes, so
   the difference is declared here rather than discovered twice. */
const TOOLS = TOOL_BASE.map((t) => ({ ...t, strict: false }));
const REALTIME_TOOLS = TOOL_BASE;

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

export function createJadeRouter({ prisma, notify, whenLabel, familyTz, openai }) {
  const router = express.Router();
  /* `openai` is injectable so the tests can run the whole route - tools,
     proposals, applying - without a key or a network call. */
  const client = openai || (API_KEY ? new OpenAI({ apiKey: API_KEY }) : null);

  const firstName = (s) => String(s || "").trim().split(/\s+/)[0]?.toLowerCase() || "";

  /* Arguments arrive as a JSON string. A model that produces malformed JSON
     should get an empty object and a tool result saying so, not take the
     whole request down. */
  const parseArgs = (raw) => {
    if (raw && typeof raw === "object") return raw;
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  };

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
     every time, so Jade never has to guess. */
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

  /* What Jade is told about the family before it answers anything. Deliberately
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
        include: WITH_VISIBILITY,
        orderBy: { startsAt: "asc" },
        take: 40
      }).then(reduceEvents),
      prisma.task.findMany({
        where: { status: "OPEN" },
        include: { member: true },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 30
      })
    ]);

    /* A task with a scheduledFor is drawn on the calendar as a TO DO block,
       so it is part of the week whether or not it is also due then. Leaving
       them out of the diary was why Jade answered about due dates when it was
       asked what was on. */
    const scheduled = tasks.filter((t) =>
      t.scheduledFor && t.scheduledFor >= from && t.scheduledFor < to);

    /* Names and roles only - the database holds no gender and no pronouns,
       so anything beyond this would be the model's own guess. */
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

    /* Carried through for the spoken session: the model reads the letters
       of a name unless it is told otherwise, which is how Rhian became
       "Ree-ann". On the typed path the browser substitutes before speaking;
       a speech-to-speech model speaks for itself, so it has to be told. */
    const saidAs = members
      .filter((m) => m.pronunciation && m.pronunciation.trim())
      .map((m) => `${m.name} is said "${m.pronunciation.trim()}"`);

    return { today, who, diary, todo, saidAs };
  }

  function systemPrompt(s, { spoken = false, speaker = null } = {}) {
    /* Who is in the room. Without this "my game on Saturday" has nothing to
       resolve against, and a task lands on whoever the screen last showed.
       On a personal phone or Rhian's desk this is reliable; on a shared
       tablet it is a guess, which is why the rule below says to ask. */
    const whoIsAsking = speaker
      ? [`You are speaking with ${speaker}.`,
         `When they say "my", "me", "I" or "mine", they mean ${speaker}.`,
         "",]
      : ["You do not know which family member you are speaking with.", ""];
    const voiceRules = [
      "",
      "You are speaking out loud, not writing:",
      "- Say dates in full. \"Thursday the twelfth of November\", never \"Thu, 12 Nov\".",
      "- One or two sentences. Someone is standing in a kitchen waiting for you.",
      "- No lists, no bullet points, no formatting of any kind - there is nothing",
      "  to look at. Join things with \"and\" and \"then\" the way a person would.",
      "- If there is a lot on, give the next two things and offer the rest.",
      ...(s.saidAs?.length
        ? ["- Say these names this way, however they are spelt: " + s.saidAs.join("; ") + "."]
        : [])
    ];
    return [
      "You are Jade, the assistant inside a family's command centre app.",
      `Today is ${s.today} and the family lives in ${familyTz}.`,
      `The family: ${s.who}.`,
      "",
      ...whoIsAsking,
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
      "- If you cannot tell who something is for, ask. A task quietly put on the",
      "  wrong person is worse than one more question, and a family stops",
      "  trusting a reminder that nags the wrong child.",
      "- \"Due\" and \"on the calendar\" are different. A task can be scheduled for",
      "  Friday and due Wednesday. Say which one you mean, and never turn a due",
      "  date into a time something is happening.",
      "- Every date above is written out. Use the dates as given rather than",
      "  working out weekdays yourself.",
      "- Some events read only as \"Busy — <name>\". That is deliberate: it is",
      "  someone's private calendar. Report it as busy and never guess what it is.",
      "- Never infer anyone's gender, and never use he, she, him, her, his or",
      "  hers about a family member. A name does not tell you someone's gender,",
      "  and getting it wrong about someone's own family is not a small error.",
      "  Use the person's name again instead, or rewrite the sentence so no",
      "  pronoun is needed. The same goes for mother, father, son, daughter,",
      "  sister and brother: say parent or child, or just use the name.",
      "- Write plain sentences. No markdown: no asterisks, no bold, no headings.",
      "  The reply is shown as text and will later be read aloud, so a ** is a",
      "  pair of asterisks on the screen and two spoken words.",
      "- Listing a day is fine: one item per line, starting with the time.",
      "- Be brief. Two or three sentences. This is read on a phone, often one-handed.",
      "- Australian spelling and 24-hour-free plain times: say 7:30pm, not 19:30.",
      ...(spoken ? voiceRules : [])
    ].join("\n");
  }

  async function runTool(name, input) {
    if (name === "check_calendar") {
      const member = input.member ? await findMember(input.member) : null;
      if (input.member && !member) return `There is nobody called ${input.member} in this family.`;
      const from = zonedToUtc(input.from, "00:00", familyTz);
      const to = new Date(zonedToUtc(input.to, "00:00", familyTz).getTime() + 86400000);
      const events = reduceEvents(await prisma.event.findMany({
        where: {
          cancelled: false, startsAt: { gte: from, lt: to },
          ...(member ? { memberId: member.id } : {})
        },
        include: WITH_VISIBILITY,
        orderBy: { startsAt: "asc" },
        take: 60
      }));
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

    return `Jade has no tool called ${name}.`;
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
    if (tool === "reschedule_task") {
      return {
        kicker: "Move a task",
        title: input.task_title,
        detail: [input.start_time ? `${input.date} at ${input.start_time}` : `${input.date}`,
                 input.duration_minutes ? `${input.duration_minutes} min` : null].filter(Boolean).join(" · ")
      };
    }
    if (tool === "move_event") {
      return {
        kicker: "Move a calendar item",
        title: input.event_title,
        detail: [input.start_time ? `${input.date} at ${input.start_time}` : `${input.date}`,
                 input.location ? `at ${input.location}` : null].filter(Boolean).join(" · ")
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
        error: "Jade is not connected yet — OPENAI_API_KEY is not set on the server."
      });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Say something to Jade first." });

    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
    const input = [...history, { role: "user", content: message }];

    try {
      const s = await snapshot();
      const speaker = await findMember(req.body?.speaker);
      const instructions = systemPrompt(s, { speaker: speaker?.name || null });
      let proposal = null;
      let said = "";

      /* Four passes is plenty: read, read again, then answer. A write tool
         ends the loop immediately, because nothing is going to run. */
      for (let pass = 0; pass < 4; pass++) {
        const reply = await client.responses.create({
          model: MODEL,
          instructions,
          tools: TOOLS,
          input
        });

        const text = String(reply.output_text || "").trim();
        if (text) said = text;

        const calls = (reply.output || []).filter((o) => o.type === "function_call");
        if (!calls.length) break;

        const write = calls.find((c) => WRITE_NAMES.has(c.name));
        if (write) {
          const args = parseArgs(write.arguments);
          const missing = missingFrom(write.name, args);
          if (!missing.length) {
            proposal = { tool: write.name, input: args, ...describeProposal(write.name, args) };
            break;
          }
          /* Hand it back rather than drafting rubbish, and let the model ask. */
          input.push(...reply.output);
          input.push({
            type: "function_call_output",
            call_id: write.call_id,
            output: `Not drafted: ${missing.join(" and ")} missing. Ask the person for it.`
          });
          continue;
        }

        /* The model's own output items go back in before their results, so
           the next pass can see what it asked for as well as the answer. */
        input.push(...reply.output);
        for (const c of calls) {
          input.push({
            type: "function_call_output",
            call_id: c.call_id,
            output: await runTool(c.name, parseArgs(c.arguments))
          });
        }
      }

      res.json({
        reply: said || (proposal ? "I've drafted that below — have a look before it goes anywhere." : "…"),
        proposal,
        /* Only the plain turns are handed back to the browser. Tool calls and
           their results are this request's working-out, not the conversation. */
        history: input.filter((m) => m && typeof m.content === "string" && m.role).slice(-8)
      });
    } catch (e) {
      console.error("Jade failed:", e?.message || e);
      res.status(502).json({ error: "Jade could not answer just now." });
    }
  });

  // ------------------------------------------------------------- realtime --
  /* The spoken path. The browser talks to OpenAI directly over WebRTC,
     because routing audio through Railway would add a hop to every syllable.
     What it does NOT get is the API key: this endpoint mints a short-lived
     client secret with the instructions and tools already baked in, so a
     tampered browser cannot reconfigure the session, give Jade different
     rules, or spend the key on anything else. The secret expires in ten
     minutes and a session is capped at an hour by OpenAI regardless. */
  router.post("/realtime/token", async (req, res) => {
    if (!API_KEY) {
      return res.status(503).json({
        error: "Talking needs OPENAI_API_KEY on the server."
      });
    }
    try {
      const s = await snapshot();
      const speaker = await findMember(req.body?.speaker);
      const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 600 },
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            instructions: systemPrompt(s, { spoken: true, speaker: speaker?.name || null }),
            audio: { output: { voice: REALTIME_VOICE } },
            tools: REALTIME_TOOLS,
            tool_choice: "auto"
          }
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("Realtime token failed:", JSON.stringify(data).slice(0, 300));
        return res.status(502).json({
          error: "Could not start a conversation.",
          detail: String(data?.error?.message || `HTTP ${r.status}`).slice(0, 200)
        });
      }
      res.json({ value: data.value, expires_at: data.expires_at, model: REALTIME_MODEL });
    } catch (e) {
      console.error("Realtime token failed:", e?.message || e);
      res.status(502).json({ error: "Could not start a conversation." });
    }
  });

  /* Tools for the spoken session. The browser relays what the model asked
     for; the decision about whether it runs is made here, on the server,
     exactly as it is for typed questions. A reading tool runs. A writing
     tool does not - it comes back as a proposal, and the model is told in
     plain words that nothing has happened yet, so it cannot tell the family
     it sent something it did not send. */
  router.post("/tool", async (req, res) => {
    const name = String(req.body?.name || "");
    const args = parseArgs(req.body?.arguments);

    if (WRITE_NAMES.has(name)) {
      const missing = missingFrom(name, args);
      if (missing.length) {
        return res.json({
          output: `Not drafted: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} ` +
                  "missing. Ask the person for it, then try again. Do not guess."
        });
      }
      const proposal = { tool: name, input: args, ...describeProposal(name, args) };
      return res.json({
        output: "Drafted, and shown on screen. Nothing has happened yet - a person " +
                "has to tap to approve it. Tell them you have drafted it and ask them to check.",
        proposal
      });
    }

    if (!READ_NAMES.has(name)) return res.json({ output: `Jade has no tool called ${name}.` });

    try {
      res.json({ output: await runTool(name, args) });
    } catch (e) {
      console.error("Jade tool failed:", e?.message || e);
      res.json({ output: "That could not be looked up just now." });
    }
  });

  // ---------------------------------------------------------------- apply --
  /* The only place a proposal becomes real. It takes the proposal back from
     the client rather than remembering it, which means the thing approved is
     the thing that was on screen. */
  router.post("/apply", async (req, res) => {
    const { tool, input } = req.body?.proposal || {};
    if (!tool || !input) return res.status(400).json({ error: "Nothing to apply." });
    /* Belt as well as braces: a proposal should never have reached the card
       with holes in it, but applying one would write rubbish to the family's
       calendar, so it is checked again here. */
    const holes = missingFrom(tool, input);
    if (holes.length) {
      return res.status(400).json({ error: `Can't do that yet — ${holes.join(" and ")} missing.` });
    }
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
          body: member ? `For ${member.name}. Added through Jade.` : "Added through Jade.",
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
          body: member ? `${member.name}'s. Added through Jade.` : "Added through Jade.",
          kind: "CHANGE", authorId: actorId, entity: "EVENT", entityId: event.id
        });
        return res.json({ ok: true, applied: "schedule_event", event });
      }

      /* Finding the thing being moved. Exact title wins; otherwise a single
         partial match. Two matches is a refusal, not a coin toss - moving
         the wrong dentist appointment is worse than asking which one. */
      const findOne = async (model, title, where = {}) => {
        const needle = String(title || "").trim().toLowerCase();
        const rows = await prisma[model].findMany({ where, take: 200 });
        const exact = rows.filter((r) => r.title.trim().toLowerCase() === needle);
        if (exact.length === 1) return { row: exact[0] };
        const partial = rows.filter((r) => r.title.toLowerCase().includes(needle));
        if (partial.length === 1) return { row: partial[0] };
        if (partial.length > 1) {
          return { error: `There is more than one: ${partial.slice(0, 4).map((r) => r.title).join(", ")}. Which one?` };
        }
        return { error: `Nothing called "${title}" was found.` };
      };

      if (tool === "reschedule_task") {
        const { row, error } = await findOne("task", input.task_title, { status: "OPEN" });
        if (error) return res.status(404).json({ error });
        const when = zonedToUtc(input.date, input.start_time || "09:00", familyTz);
        const task = await prisma.task.update({
          where: { id: row.id },
          data: {
            scheduledFor: when,
            durationMins: input.duration_minutes ? Number(input.duration_minutes) : (row.durationMins ?? 30)
          },
          include: { member: true, list: true }
        });
        await notify({
          title: `${task.title} is now ${whenLabel(when, false)}`,
          body: "Moved through Jade.",
          kind: "CHANGE", authorId: actorId, entity: "TASK", entityId: task.id
        });
        return res.json({ ok: true, applied: "reschedule_task", task });
      }

      if (tool === "move_event") {
        const { row, error } = await findOne("event", input.event_title, { cancelled: false });
        if (error) return res.status(404).json({ error });
        const mins = Math.max(
          15,
          Number(input.duration_minutes || Math.round((row.endsAt - row.startsAt) / 60000) || 60)
        );
        /* No start_time means "same time, different day", which is what
           "move it to Friday" almost always means. */
        const keep = new Intl.DateTimeFormat("en-GB", {
          timeZone: familyTz, hour: "2-digit", minute: "2-digit", hour12: false
        }).format(row.startsAt);
        const startsAt = zonedToUtc(input.date, input.start_time || keep, familyTz);
        const event = await prisma.event.update({
          where: { id: row.id },
          data: {
            startsAt,
            endsAt: new Date(startsAt.getTime() + mins * 60000),
            ...(input.location ? { location: String(input.location) } : {})
          },
          include: { member: true, calendar: true }
        });
        await notify({
          title: `${event.title} has moved to ${whenLabel(startsAt, event.allDay)}`,
          body: input.location ? `Now at ${input.location}. Moved through Jade.` : "Moved through Jade.",
          kind: "CHANGE", authorId: actorId, entity: "EVENT", entityId: event.id
        });
        return res.json({ ok: true, applied: "move_event", event });
      }

      if (tool === "notify_family") {
        const notice = await notify({
          title: String(input.title).trim(),
          body: input.body ? String(input.body) : null,
          kind: "FAMILY_NOTICE", authorId: actorId
        });
        return res.json({ ok: true, applied: "notify_family", notice });
      }

      res.status(400).json({ error: `Jade cannot apply ${tool}.` });
    } catch (e) {
      console.error("Jade apply failed:", e.message);
      res.status(500).json({ error: "That could not be applied." });
    }
  });

  /* ?probe=1 makes one real call. Worth the few cents: a wrong model name
     or a rejected key otherwise shows up as a generic 502 with the actual
     reason buried in Railway's logs. */
  router.get("/status", async (req, res) => {
    const out = { connected: !!client, model: client ? MODEL : null };
    if (!client || req.query.probe !== "1") return res.json(out);
    try {
      const r = await client.responses.create({
        model: MODEL,
        instructions: "Reply with the single word: ready.",
        input: [{ role: "user", content: "ready?" }]
      });
      out.probe = "ok";
      out.said = String(r.output_text || "").trim().slice(0, 40);
    } catch (e) {
      out.probe = "failed";
      out.detail = String(e?.message || e).split("\n")[0].slice(0, 200);
    }
    res.json(out);
  });

  /* ?realtime=1 tries to mint a conversation token and reports what OpenAI
     said. The browser-side failure is easy to miss - it falls back to the
     simpler voice and carries on - so there has to be somewhere to look. */
  router.get("/realtime/check", async (_req, res) => {
    if (!API_KEY) return res.json({ ok: false, why: "OPENAI_API_KEY is not set" });
    try {
      const s = await snapshot();
      const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            instructions: systemPrompt(s, { spoken: true }),
            audio: { output: { voice: REALTIME_VOICE } },
            tools: REALTIME_TOOLS,
            tool_choice: "auto"
          }
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.json({
          ok: false, status: r.status, model: REALTIME_MODEL, voice: REALTIME_VOICE,
          why: String(data?.error?.message || JSON.stringify(data)).slice(0, 400),
          param: data?.error?.param || null, code: data?.error?.code || null
        });
      }
      res.json({
        ok: true, model: REALTIME_MODEL, voice: REALTIME_VOICE,
        gotToken: typeof data.value === "string", expires_at: data.expires_at ?? null
      });
    } catch (e) {
      res.json({ ok: false, why: String(e?.message || e).slice(0, 400) });
    }
  });

  return router;
}

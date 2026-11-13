import express from "express";
import OpenAI from "openai";
import { reduceEvents, WITH_VISIBILITY } from "./visibility.js";
import { IDEA_TOOLS, IDEA_NAMES } from "./ideas.js";

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
        due_date: { type: "string", description: "Optional YYYY-MM-DD - the day it has to be done by" },
        do_date: { type: "string", description: "Optional YYYY-MM-DD - the day they plan to do it" },
        do_time: { type: "string", description: "Optional HH:mm, 24 hour - when they plan to do it" },
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
    name: "move_item",
    description:
      "Propose moving something that is already there - a calendar event or a task with a " +
      "time - to a different time, day or place. Use this for move, reschedule, push back, " +
      "bring forward, or 'make it 6 instead'. It searches events and tasks together, so you " +
      "do not need to know which it is. " +
      "Give only what is changing: to move 5pm to 6pm, send start_time and no date. " +
      "Take the title from the week you were already given - a few words of it is enough, " +
      "and you do not need the person to repeat it.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Enough of its title to find it. Partial is fine." },
        date: { type: "string", description: "YYYY-MM-DD. Omit to keep the day it is on." },
        start_time: { type: "string", description: "HH:mm, 24 hour. Omit to keep the time." },
        duration_minutes: { type: "number", description: "Only if the length is changing." },
        location: { type: "string", description: "Only if where it happens is changing." }
      },
      required: ["title"]
    }
  },
  {
    name: "complete_task",
    description:
      "Mark a task as done. Use this when someone says they have done something, finished " +
      "it, or that it is sorted. If it is the speaker's own task it is ticked off straight " +
      "away; anyone else's comes back as a proposal to approve. Take the title from the " +
      "tasks you were given - a few words of it is enough.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Enough of its title to find it. Partial is fine." }
      },
      required: ["title"]
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
  move_item: ["title"],
  complete_task: ["title"],
  notify_family: ["title"]
};
function missingFrom(tool, args) {
  const gaps = (REQUIRED[tool] || []).filter((f) => !String(args?.[f] ?? "").trim());
  /* Moving needs something to change, but it does not need all of it: a date
     with no time keeps the time, a time with no date keeps the day. Asking
     for both is how "make it 6 instead of 5" turned into an interrogation. */
  if (tool === "move_item" && !gaps.length) {
    const changes = ["date", "start_time", "duration_minutes", "location"]
      .some((f) => String(args?.[f] ?? "").trim());
    if (!changes) gaps.push("what is changing - a new time, day or place");
  }
  return gaps;
}
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
const TOOL_BASE = [...READ_TOOLS, ...WRITE_TOOLS, ...IDEA_TOOLS].map((t) => ({
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

export function createJadeRouter({ prisma, notify, whenLabel, familyTz, openai, ideas = null }) {
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

  /* Every day for the next fortnight, written out: "Mon 16 Nov = 2026-11-16".
     "By Monday" landed on Saturday when Jade did the weekday maths herself. */
  function nextDays() {
    const out = [];
    const start = zonedToUtc(todayIn(familyTz), "12:00", familyTz);
    for (let i = 0; i < 14; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const label = new Intl.DateTimeFormat("en-AU", { timeZone: familyTz, weekday: "long", day: "numeric", month: "short" }).format(d);
      out.push(`  ${label} = ${new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d)}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`);
    }
    return out.join("\n");
  }

  function systemPrompt(s, { spoken = false, speaker = null, about = null, ideaList = null } = {}) {
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
      "The next fortnight, so you never work out a weekday yourself:",
      nextDays(),
      `The family: ${s.who}.`,
      "",
      ...whoIsAsking,
      ...(about ? [about, ""] : []),
      "The next seven days:",
      s.diary,
      "",
      "Open tasks:",
      s.todo,
      ...(ideaList ? [
        "",
        "Ideas on the family's board:",
        ideaList,
        "",
        "Ideas: when someone tells you an idea, let them talk and save it with save_idea once they",
        "say they are done. \"Add to the X idea\" is update_idea - rewrite its title, short line and",
        "summary to cover everything so far. A short line is about fifteen words; a summary is three",
        "to five sentences. Only the person who raised an idea can turn it into tasks.",
      ] : []),
      "",
      "How you work:",
      "- Answer from what you have above when it is enough. Use check_calendar or",
      "  list_tasks when you need more than a week, or a specific person's detail.",
      "- complete_task and move_item on the speaker's OWN task happen straight",
      "  away, and the tool result says so - then confirm it in a few words",
      "  (\"Done, bins ticked off\"). Everything else - add_task, schedule_event,",
      "  notify_family, and anything belonging to someone else - is only drafted",
      "  for a person to approve. When a tool result says it was drafted, say so",
      "  and that it needs their go-ahead.",
      "- Never claim something has been done unless the tool result says it was.",
      "- Task or calendar? Something a person needs to DO - especially \"by\" a day, or",
      "  \"needs to\", \"has to\", \"remember to\" - is a task: use add_task, with the day as",
      "  due_date. A calendar item (schedule_event) is only for being somewhere or something",
      "  happening at a set time: a match, an appointment, a dinner. If unsure, it is a task.",
      "- Adding a task: if they have not said when they will do it, ask once - \"When are you",
      "  going to do it?\" - and put the answer in do_date and do_time. If they do not know,",
      "  add it with just the due date; they get a reminder the night before and that morning.",
      "- Names: only ever use a name from the family list. If what you heard does not match",
      "  anyone exactly, ask \"Did you mean ...?\" with the closest name. Never guess, and never",
      "  leave a task unallocated because you were not sure who it was for.",
      "- If you cannot tell who something is for, ask. A task quietly put on the",
      "  wrong person is worse than one more question, and a family stops",
      "  trusting a reminder that nags the wrong child.",
      "- You already have the week above. Take titles from it; never ask someone",
      "  to repeat the name of something you can see, or to spell it exactly.",
      "  Moving is one tool, move_item, and it searches events and tasks",
      "  together - you do not need to know which it is. Send only what changes:",
      "  a new time with no date keeps the day, a new day with no time keeps",
      "  the time.",
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
    const nice = (date, time) => {
      if (!date) return null;
      const d = zonedToUtc(date, time || "12:00", familyTz);
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: familyTz, weekday: "short", day: "numeric", month: "short",
        ...(time ? { hour: "numeric", minute: "2-digit" } : {})
      }).format(d);
    };
    if (tool === "add_task") {
      return {
        kicker: "New task",
        title: input.title,
        detail: [input.member ? `for ${input.member}` : "unallocated",
                 input.do_date ? `do it ${nice(input.do_date, input.do_time)}` : null,
                 input.due_date ? `due ${nice(input.due_date)}` : null].filter(Boolean).join(" · ")
      };
    }
    if (tool === "schedule_event") {
      const when = input.start_time ? nice(input.date, input.start_time) : `${nice(input.date)}, all day`;
      return {
        kicker: "New calendar item",
        title: input.title,
        detail: [when, input.member ? input.member : "family",
                 input.location || null].filter(Boolean).join(" · ")
      };
    }
    if (tool === "move_item") {
      /* Only what is changing, so the card says "to 6:00pm" rather than
         restating a date nobody touched. */
      return {
        kicker: "Move it",
        title: input.title,
        detail: ["to",
                 input.date ? nice(input.date, input.start_time) : (input.start_time || null),
                 input.duration_minutes ? `for ${input.duration_minutes} min` : null,
                 input.location ? `at ${input.location}` : null
                ].filter(Boolean).join(" ")
      };
    }
    if (tool === "complete_task") {
      return { kicker: "Mark done", title: input.title, detail: "Someone else's task - tick it off for them?" };
    }
    if (tool === "notify_family") {
      return { kicker: "Notice to the whole family", title: input.title, detail: input.body || "" };
    }
    return { kicker: "Proposal", title: tool, detail: "" };
  }

  // ------------------------------------------------------- own tasks, now --
  /* Voice is the point, and saying "I've done the bins" then having to tap
     Approve defeats it. So two things happen straight away, with no card:
     ticking off, and moving, a task that belongs to the person speaking.
     Anything of anyone else's, and anything that adds or announces, is still
     drafted for approval. The result carries what it was before, so the
     screen can offer Undo if Jade misheard.

     Who is speaking comes from the "Viewing as" picker on that device until
     per-person sign-in exists - the same trust the rest of the app runs on. */
  const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d);
  const timeOf = (d) => new Intl.DateTimeFormat("en-GB", {
    timeZone: familyTz, hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);

  function pick(pool, title) {
    const needle = String(title || "").trim().toLowerCase();
    const exact = pool.filter((x) => x.title.trim().toLowerCase() === needle);
    if (exact.length === 1) return { hit: exact[0], many: [] };
    const partial = pool.filter((x) => x.title.toLowerCase().includes(needle));
    if (partial.length === 1) return { hit: partial[0], many: [] };
    return { hit: null, many: partial };
  }

  /* Returns { output, applied } when it handled the call itself, or null to
     fall through to the ordinary proposal. */
  async function tryDirect(tool, input, speaker) {
    if (!speaker || !["complete_task", "move_item"].includes(tool)) return null;
    const open = await prisma.task.findMany({ where: { status: "OPEN" }, take: 200 });

    if (tool === "complete_task") {
      const { hit, many } = pick(open, input.title);
      if (!hit) {
        return {
          output: many.length > 1
            ? `More than one matches: ${many.slice(0, 4).map((t) => t.title).join(", ")}. Ask which one.`
            : `There is no open task called "${input.title}".`
        };
      }
      if (hit.memberId !== speaker.id) return null;          // someone else's: draft it
      await prisma.task.update({ where: { id: hit.id }, data: { status: "DONE", completedAt: new Date() } });
      await prisma.activityLog.create({
        data: { action: "task.done", entity: "Task", entityId: hit.id, memberId: speaker.id, detail: { via: "jade" } }
      }).catch(() => {});
      return {
        output: `Done - "${hit.title}" is ticked off. Confirm it in a few words.`,
        applied: { kind: "complete", taskId: hit.id, title: hit.title, before: { status: "OPEN", completedAt: null } }
      };
    }

    // move_item: straight away only for one of the speaker's own tasks.
    const events = await prisma.event.findMany({ where: { cancelled: false }, take: 200 });
    const { hit } = pick([
      ...open.map((t) => ({ ...t, kind: "task" })),
      ...events.map((ev) => ({ ...ev, kind: "event" }))
    ], input.title);
    if (!hit || hit.kind !== "task" || hit.memberId !== speaker.id) return null;

    const current = hit.scheduledFor || hit.dueAt;
    const date = input.date || (current ? dayOf(current) : todayIn(familyTz));
    const time = input.start_time || (current ? timeOf(current) : "09:00");
    const startsAt = zonedToUtc(date, time, familyTz);
    const mins = Number(input.duration_minutes || hit.durationMins || 30);
    await prisma.task.update({ where: { id: hit.id }, data: { scheduledFor: startsAt, durationMins: mins } });
    await prisma.activityLog.create({
      data: { action: "task.move", entity: "Task", entityId: hit.id, memberId: speaker.id, detail: { via: "jade" } }
    }).catch(() => {});
    return {
      output: `Moved - "${hit.title}" is now ${stamp(startsAt, false)}. Confirm it in a few words.`,
      applied: {
        kind: "move", taskId: hit.id, title: hit.title,
        before: { scheduledFor: hit.scheduledFor, durationMins: hit.durationMins }
      }
    };
  }

  /* A name Jade heard that is not in the family: hand it back so she asks,
     rather than drafting a task for nobody that nobody is reminded about. */
  async function unknownMember(tool, args) {
    if (!["add_task", "schedule_event"].includes(tool)) return null;
    if (!String(args?.member || "").trim() || await findMember(args.member)) return null;
    const names = (await prisma.familyMember.findMany()).map((m) => m.name).join(", ");
    return `Not drafted: nobody called "${args.member}" is in this family (${names}). ` +
           "Ask \"Did you mean ...?\" with the closest name. Do not guess.";
  }

  /* Opened from a reminder: Jade is told which task, and to ask about it. */
  async function aboutLine(taskId) {
    const id = Number(taskId);
    if (!Number.isInteger(id)) return null;
    const t = await prisma.task.findUnique({ where: { id }, include: { member: true } });
    if (!t) return null;
    if (t.status === "DONE") return `They opened you about "${t.title}", which is already ticked off. Say so briefly.`;
    return [
      `They opened you from the reminder about their task "${t.title}" (${taskWhen(t)}).`,
      "Open by asking, in one short sentence, whether it is done or when they will do it.",
      "If it is done, use complete_task. If they want it later, use move_item with the new time."
    ].join(" ");
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
      const instructions = systemPrompt(s, {
        speaker: speaker?.name || null,
        about: (await aboutLine(req.body?.aboutTaskId)) || (ideas ? await ideas.aboutLine(req.body?.idea, speaker) : null),
        ideaList: ideas ? await ideas.listForPrompt(speaker) : null
      });
      let proposal = null;
      let applied = null;
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
        for (const c of calls) {
          console.log(JSON.stringify({ event: "jade.tool", via: "typed", name: c.name, speaker: speaker?.name || null, args: parseArgs(c.arguments) }));
        }

        /* Ideas are their own: saving and updating happen straight away (the
           idea is theirs), turning one into tasks comes back as a proposal. */
        const ideaCall = ideas && calls.find((c) => IDEA_NAMES.has(c.name));
        if (ideaCall) {
          const soFar = input
            .filter((m) => m && m.role && typeof m.content === "string")
            .map((m) => `${m.role === "user" ? (speaker?.name || "Them") : "Jade"}: ${m.content}`)
            .join("\n");
          const r = await ideas.runTool(ideaCall.name, parseArgs(ideaCall.arguments), {
            speaker, transcript: soFar, aboutIdeaId: req.body?.idea?.id
          });
          if (r.applied) applied = r.applied;
          if (r.proposal) { proposal = r.proposal; break; }
          input.push(...reply.output);
          for (const c of calls) {
            input.push({ type: "function_call_output", call_id: c.call_id,
                         output: c === ideaCall ? r.output : "Not run - one thing at a time." });
          }
          continue;
        }

        const write = calls.find((c) => WRITE_NAMES.has(c.name));
        if (write) {
          const args = parseArgs(write.arguments);
          const whoNot = await unknownMember(write.name, args);
          if (whoNot) {
            input.push(...reply.output);
            for (const c of calls) {
              input.push({ type: "function_call_output", call_id: c.call_id,
                           output: c === write ? whoNot : "Not run - one thing at a time." });
            }
            continue;
          }
          const missing = missingFrom(write.name, args);
          if (!missing.length) {
            /* The speaker's own task: done or moved now, then the model gets
               another pass to say so. */
            const direct = await tryDirect(write.name, args, speaker);
            if (direct) {
              if (direct.applied) applied = direct.applied;
              input.push(...reply.output);
              input.push({ type: "function_call_output", call_id: write.call_id, output: direct.output });
              continue;
            }
            proposal = { tool: write.name, input: args, ...describeProposal(write.name, args) };
            break;
          }
          /* Hand it back rather than drafting rubbish, and let the model ask. */
          input.push(...reply.output);
          input.push({
            type: "function_call_output",
            call_id: write.call_id,
            output: `Not drafted: ${missing.join(" and ")} missing. Take the title from the ` +
                    `week you were given; only ask the person for what you genuinely do not have.`
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
        applied,
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
            instructions: systemPrompt(s, {
              spoken: true,
              speaker: speaker?.name || null,
              about: (await aboutLine(req.body?.aboutTaskId)) || (ideas ? await ideas.aboutLine(req.body?.idea, speaker) : null),
        ideaList: ideas ? await ideas.listForPrompt(speaker) : null
            }),
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
    console.log(JSON.stringify({ event: "jade.tool", via: "voice", name, speaker: req.body?.speaker || null, args }));

    if (IDEA_NAMES.has(name)) {
      if (!ideas) return res.json({ output: "Ideas are not available here." });
      try {
        return res.json(await ideas.runTool(name, args, {
          speaker: await findMember(req.body?.speaker),
          transcript: String(req.body?.transcript || "").slice(0, 20000),
          aboutIdeaId: req.body?.ideaId
        }));
      } catch (e) {
        console.error("Jade idea tool failed:", e?.message || e);
        return res.json({ output: "That could not be saved just now. Say so." });
      }
    }

    if (WRITE_NAMES.has(name)) {
      const whoNot = await unknownMember(name, args);
      if (whoNot) return res.json({ output: whoNot });
      const missing = missingFrom(name, args);
      if (missing.length) {
        return res.json({
          output: `Not drafted: ${missing.join(" and ")} missing. ` +
                  "You already have this week's calendar and tasks - take the title from " +
                  "there rather than asking anyone to repeat it. Only ask the person if " +
                  "two things genuinely match, or if the new time is the part you do not have."
        });
      }
      /* The speaker's own task is done or moved now, not drafted. */
      try {
        const direct = await tryDirect(name, args, await findMember(req.body?.speaker));
        if (direct) return res.json(direct);
      } catch (e) {
        console.error("Jade direct change failed:", e?.message || e);
        return res.json({ output: "That could not be changed just now. Say so." });
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
            dueAt: input.due_date ? zonedToUtc(input.due_date, "09:00", familyTz) : null,
            scheduledFor: input.do_date ? zonedToUtc(input.do_date, input.do_time || "09:00", familyTz) : null
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
        /* The person's own calendar if they have one (never a busy-only work
           calendar), otherwise the Family calendar tagged with their name -
           which is how the children's events have always been kept. */
        const calendar =
          (member && await prisma.calendar.findFirst({
            where: { memberId: member.id, defaultVisibility: "FULL" }, orderBy: { id: "asc" }
          })) ||
          await prisma.calendar.findFirst({ where: { memberId: null }, orderBy: { id: "asc" } });
        if (!calendar) return res.status(500).json({ error: "There is no family calendar to put it on." });
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

      if (tool === "move_item") {
        /* Tasks and events together, because nobody asking to move something
           knows or cares which one it is in the database. */
        const needle = String(input.title || "").trim().toLowerCase();
        const [tasks, events] = await Promise.all([
          prisma.task.findMany({ where: { status: "OPEN" }, take: 200 }),
          prisma.event.findMany({ where: { cancelled: false }, take: 200 })
        ]);
        const pool = [
          ...tasks.map((row) => ({ kind: "task", row })),
          ...events.map((row) => ({ kind: "event", row }))
        ];
        const exact = pool.filter((x) => x.row.title.trim().toLowerCase() === needle);
        const partial = pool.filter((x) => x.row.title.toLowerCase().includes(needle));
        const hit = exact.length === 1 ? exact[0] : (partial.length === 1 ? partial[0] : null);
        if (!hit) {
          if (partial.length > 1) {
            return res.status(409).json({
              error: `More than one matches: ${partial.slice(0, 4).map((x) => x.row.title).join(", ")}. Which one?`
            });
          }
          return res.status(404).json({ error: `Nothing called "${input.title}" was found.` });
        }

        /* Whatever is not being changed stays as it is. "Make it 6" keeps the
           day; "move it to Friday" keeps the time. */
        const current = hit.kind === "task" ? (hit.row.scheduledFor || hit.row.dueAt) : hit.row.startsAt;
        const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: familyTz }).format(d);
        const timeOf = (d) => new Intl.DateTimeFormat("en-GB", {
          timeZone: familyTz, hour: "2-digit", minute: "2-digit", hour12: false
        }).format(d);

        const date = input.date || (current ? dayOf(current) : todayIn(familyTz));
        const time = input.start_time || (current ? timeOf(current) : "09:00");
        const startsAt = zonedToUtc(date, time, familyTz);

        if (hit.kind === "task") {
          const mins = Number(input.duration_minutes || hit.row.durationMins || 30);
          const task = await prisma.task.update({
            where: { id: hit.row.id },
            data: { scheduledFor: startsAt, durationMins: mins },
            include: { member: true, list: true }
          });
          await notify({
            title: `${task.title} is now ${whenLabel(startsAt, false)}`,
            body: "Moved through Jade.",
            kind: "CHANGE", authorId: actorId, entity: "TASK", entityId: task.id
          });
          return res.json({ ok: true, applied: "move_item", kind: "task", task });
        }

        const mins = Math.max(15, Number(
          input.duration_minutes || Math.round((hit.row.endsAt - hit.row.startsAt) / 60000) || 60
        ));
        const event = await prisma.event.update({
          where: { id: hit.row.id },
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
        return res.json({ ok: true, applied: "move_item", kind: "event", event });
      }

      if (tool === "ideas_to_tasks") {
        if (!ideas) return res.status(400).json({ error: "Ideas are not available." });
        const r = await ideas.applyTasks(input, actorId);
        return r.ok ? res.json(r) : res.status(403).json({ error: r.error });
      }

      if (tool === "complete_task") {
        const needle = String(input.title || "").trim().toLowerCase();
        const open = await prisma.task.findMany({ where: { status: "OPEN" }, take: 200 });
        const { hit, many } = pick(open, needle);
        if (!hit) {
          return res.status(many.length > 1 ? 409 : 404).json({
            error: many.length > 1
              ? `More than one matches: ${many.slice(0, 4).map((t) => t.title).join(", ")}. Which one?`
              : `Nothing open called "${input.title}" was found.`
          });
        }
        const task = await prisma.task.update({
          where: { id: hit.id },
          data: { status: "DONE", completedAt: new Date() },
          include: { member: true, list: true }
        });
        await prisma.activityLog.create({
          data: { action: "task.done", entity: "Task", entityId: task.id, memberId: actorId, detail: { via: "jade" } }
        }).catch(() => {});
        return res.json({ ok: true, applied: "complete_task", task });
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
      // Say why, briefly - "could not be applied" alone hid a missing calendar.
      const why = String(e.message || "").split("\n").filter(Boolean).pop() || "unknown error";
      res.status(500).json({ error: `That could not be applied: ${why.slice(0, 160)}` });
    }
  });

  /* Undo for a change Jade made straight away. Puts back exactly what the
     change reported as "before", and only those fields. */
  router.post("/undo", async (req, res) => {
    const id = Number(req.body?.taskId);
    const b = req.body?.before || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Nothing to undo." });
    const data = {};
    if ("status" in b)       data.status = b.status === "DONE" ? "DONE" : "OPEN";
    if ("completedAt" in b)  data.completedAt = b.completedAt ? new Date(b.completedAt) : null;
    if ("scheduledFor" in b) data.scheduledFor = b.scheduledFor ? new Date(b.scheduledFor) : null;
    if ("durationMins" in b) data.durationMins = b.durationMins == null ? null : Number(b.durationMins);
    try {
      const task = await prisma.task.update({ where: { id }, data });
      res.json({ ok: true, task });
    } catch (e) {
      res.status(404).json({ error: "That task is no longer there." });
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
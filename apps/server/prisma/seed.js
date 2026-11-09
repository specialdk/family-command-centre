import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dates are relative to the run, so a freshly seeded database always looks
// like "this week" rather than August 2026.
const DAY = 86400000;
const at = (days, hour, min = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, min, 0, 0);
  return d;
};

const PEOPLE = [
  { name: "Rhian",    initials: "RO", role: "PARENT", colorKey: "rhian",    sortOrder: 1, canSignIn: true },
  { name: "Danielle", initials: "DO", role: "PARENT", colorKey: "danielle", sortOrder: 2, canSignIn: true },
  { name: "Lachie",   initials: "LO", role: "CHILD",  colorKey: "lachie",   sortOrder: 3 },
  { name: "Jack",     initials: "JO", role: "CHILD",  colorKey: "jack",     sortOrder: 4 },
  { name: "Maddie",   initials: "MO", role: "CHILD",  colorKey: "maddie",   sortOrder: 5 }
];

const LISTS = ["Family", "Home", "School", "Work", "Unallocated"];

async function main() {
  // --- people: always reconciled, safe to re-run -------------------------
  for (const p of PEOPLE) {
    await prisma.familyMember.upsert({ where: { name: p.name }, update: p, create: p });
  }
  const members = await prisma.familyMember.findMany();
  const by = Object.fromEntries(members.map((m) => [m.name, m.id]));

  // --- task lists --------------------------------------------------------
  for (const [i, name] of LISTS.entries()) {
    const existing = await prisma.taskList.findFirst({ where: { name, source: "LOCAL" } });
    if (!existing) await prisma.taskList.create({ data: { name, sortOrder: i } });
  }
  const lists = await prisma.taskList.findMany();
  const list = Object.fromEntries(lists.map((l) => [l.name, l.id]));

  // --- calendars ---------------------------------------------------------
  const CALENDARS = [
    { name: "Family",         memberId: null,       color: "family",   defaultVisibility: "FULL" },
    { name: "Rhian",          memberId: by.Rhian,   color: "rhian",    defaultVisibility: "FULL" },
    // Work events sync in but show only as "Busy - Rhian".
    { name: "Rhian · Work",   memberId: by.Rhian,   color: "rhian",    defaultVisibility: "BUSY" },
    { name: "Danielle",       memberId: by.Danielle, color: "danielle", defaultVisibility: "FULL" }
  ];
  for (const c of CALENDARS) {
    const existing = await prisma.calendar.findFirst({ where: { name: c.name, source: "LOCAL" } });
    if (!existing) await prisma.calendar.create({ data: c });
  }
  const cals = await prisma.calendar.findMany();
  const cal = Object.fromEntries(cals.map((c) => [c.name, c.id]));

  // --- events: only when empty, so real entries are never trampled -------
  if ((await prisma.event.count()) === 0) {
    await prisma.event.createMany({
      data: [
        { calendarId: cal.Family, memberId: by.Lachie, title: "Lachie's match",
          location: "Glenunga Oval", startsAt: at(0, 10, 30), endsAt: at(0, 12) },
        { calendarId: cal.Family, memberId: null, title: "Family dinner",
          location: "Home", startsAt: at(0, 18, 30), endsAt: at(0, 20) },
        { calendarId: cal["Rhian · Work"], memberId: by.Rhian, title: "Client review",
          startsAt: at(1, 9), endsAt: at(1, 10, 30), visibility: "BUSY" },
        { calendarId: cal.Danielle, memberId: by.Maddie, title: "Dentist — Maddie",
          location: "Burnside", startsAt: at(1, 14), endsAt: at(1, 15) },
        { calendarId: cal.Family, memberId: by.Jack, title: "Jack — learner driver practice",
          startsAt: at(2, 16), endsAt: at(2, 17) },
        { calendarId: cal.Family, memberId: null, title: "School term break begins",
          startsAt: at(5, 0), endsAt: at(5, 23, 59), allDay: true },
        // A weekly series. The RRULE is stored; instances expand at read time.
        { calendarId: cal.Family, memberId: by.Danielle, title: "Netball training",
          location: "Burnside Stadium", startsAt: at(3, 17), endsAt: at(3, 18, 30),
          recurrenceRule: "FREQ=WEEKLY;BYDAY=TU" }
      ]
    });
  }

  // --- tasks and routines ------------------------------------------------
  if ((await prisma.task.count()) === 0) {
    await prisma.task.createMany({
      data: [
        { title: "Allocate times for Jack's learner-driver practice", listId: list.Family, memberId: by.Rhian },
        { title: "Create a dinner recipe list, including quantities", listId: list.Home, memberId: by.Rhian, dueAt: at(2, 18) },
        { title: "Organise the passport", listId: list.Family, memberId: by.Rhian, needsHelp: true },
        { title: "Confirm university timetable", listId: list.School, memberId: by.Maddie, dueAt: at(1, 12) },
        { title: "Clean up the bottom shed", listId: list.Home, memberId: by.Rhian, scheduledFor: at(1, 9), durationMins: 90 },
        { title: "Someone needs to pick up the dry cleaning", listId: list.Unallocated },
        { title: "Design a digital filing system for scanned documents", listId: list.Work, memberId: by.Rhian },
        { title: "Order groceries", listId: list.Home, memberId: by.Danielle, status: "DONE", completedAt: at(-1, 17) },

        // Routines — what used to be the Chore model.
        { title: "Put school clothes out", kind: "CHORE", listId: list.Home, memberId: by.Lachie,
          recurrenceRule: "FREQ=DAILY", scheduledFor: at(0, 19, 30) },
        { title: "Feed the dogs", kind: "CHORE", listId: list.Home, memberId: by.Jack,
          recurrenceRule: "FREQ=DAILY", scheduledFor: at(0, 18) },
        { title: "Put the bins out", kind: "CHORE", listId: list.Home, memberId: by.Lachie,
          recurrenceRule: "FREQ=WEEKLY;BYDAY=SU", scheduledFor: at(2, 19) },
        { title: "Put washing in the laundry", kind: "CHORE", listId: list.Home, memberId: by.Maddie,
          recurrenceRule: "FREQ=DAILY", status: "DONE", completedAt: at(0, 7) },
        { title: "Allocate next week's recurring family tasks", kind: "ROUTINE", listId: list.Family,
          memberId: by.Rhian, recurrenceRule: "FREQ=WEEKLY;BYDAY=SU", scheduledFor: at(2, 17) }
      ]
    });
  }

  // --- shopping ----------------------------------------------------------
  if ((await prisma.shoppingItem.count()) === 0) {
    await prisma.shoppingItem.createMany({
      data: [
        { name: "Milk",          quantity: "2 × 2L",      store: "ALDI",   addedById: by.Danielle, position: 1 },
        { name: "Bread",         quantity: "2 loaves",    store: "ALDI",   addedById: by.Danielle, position: 2 },
        { name: "Bananas",       quantity: "1 bunch",     store: "ALDI",   addedById: by.Rhian,    position: 3 },
        { name: "Chicken stock", quantity: "1 × 1L carton", store: "Coles", addedById: by.Rhian,   position: 4 },
        { name: "Olive oil spray",                        store: "Coles",  addedById: by.Rhian,    position: 5 },
        { name: "Dog food",      quantity: "bulk",        store: "Drakes", addedById: by.Jack,     position: 6 },
        { name: "Dishwasher tablets", quantity: "1 box",  store: "ALDI",   addedById: by.Danielle, position: 7, checked: true }
      ]
    });
  }

  // --- meals -------------------------------------------------------------
  if ((await prisma.meal.count()) === 0) {
    await prisma.meal.createMany({
      data: [
        { name: "Chicken & Mushroom Risotto", notes: "A creamy family dinner that is easy to prepare together.", plannedFor: at(0, 18, 30) },
        { name: "Spinach Pie",    notes: "From the Oliver family collection.", plannedFor: at(1, 18, 30) },
        { name: "Fish Casserole", notes: "From the Oliver family collection.", plannedFor: at(2, 18, 30) },
        { name: "Slow-cooked lamb", notes: "Sunday roast.", plannedFor: at(4, 18) },
        { name: "Pasta bake",     notes: "Quick weeknight option." }
      ]
    });
  }

  const counts = {
    members: await prisma.familyMember.count(),
    calendars: await prisma.calendar.count(),
    events: await prisma.event.count(),
    taskLists: await prisma.taskList.count(),
    tasks: await prisma.task.count(),
    shopping: await prisma.shoppingItem.count(),
    meals: await prisma.meal.count()
  };
  console.log("seed complete:", JSON.stringify(counts));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

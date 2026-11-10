/* What an event is allowed to look like once it leaves the server.

   This lives on its own because it has to be the only copy. The dashboard
   had its own inline version and Sol read the database directly, which meant
   asking Sol was a way round the reduction: the browser showed "Busy — Rhian"
   while Sol read out the real title. Anything that sends an event anywhere
   goes through here.

   FULL    - as written.
   BUSY    - the fact of it, and whose it is. No title, location or notes.
   PRIVATE - does not exist outside the server.

   An event's own visibility wins; FULL defers to the calendar's default, so
   a work calendar can be busy-only without every event saying so. */

export function reduceEvent(e) {
  const vis = e.visibility === "FULL" ? (e.calendar?.defaultVisibility || "FULL") : e.visibility;
  if (vis === "PRIVATE") return null;
  if (vis === "BUSY") {
    return { ...e, title: `Busy — ${e.member?.name || "Family"}`, location: null, notes: null, busy: true };
  }
  return e;
}

/* Reducing needs the calendar, so anything calling reduceEvent must include
   it. Prisma quietly returns undefined for a relation that was not included,
   which would silently make every event look FULL - exactly the failure this
   module exists to prevent. */
export const WITH_VISIBILITY = { member: true, calendar: true };

export const reduceEvents = (events) => events.map(reduceEvent).filter(Boolean);

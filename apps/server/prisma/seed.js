import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const people = [
    { name: "Rhian", initials: "RO", role: "Parent" },
    { name: "Danielle", initials: "DO", role: "Parent" },
    { name: "Lachie", initials: "LO", role: "Child" },
    { name: "Jack", initials: "JO", role: "Child" },
    { name: "Maddie", initials: "MO", role: "Child" }
  ];

  for (const person of people) {
    await prisma.familyMember.upsert({
      where: { name: person.name },
      update: person,
      create: person
    });
  }

  const count = await prisma.task.count();
  if (!count) {
    const members = await prisma.familyMember.findMany();
    const byName = Object.fromEntries(members.map(m => [m.name, m.id]));
    await prisma.task.createMany({
      data: [
        { title: "Review school commitments", list: "HOME", memberId: byName.Lachie },
        { title: "Confirm family weekend plans", list: "HOME", memberId: byName.Danielle },
        { title: "Unallocated family task", list: "UNALLOCATED" }
      ]
    });
  }

  const shoppingCount = await prisma.shoppingItem.count();
  if (!shoppingCount) {
    await prisma.shoppingItem.createMany({
      data: [
        { name: "Milk", quantity: "2", store: "Aldi" },
        { name: "Fruit", quantity: "1 bag", store: "Aldi" }
      ]
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');
CREATE TYPE "TaskList" AS ENUM ('HOME', 'WORK', 'SCHOOL', 'UNALLOCATED');

CREATE TABLE "FamilyMember" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "initials" TEXT NOT NULL,
  "role" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FamilyMember_name_key" ON "FamilyMember"("name");

CREATE TABLE "Task" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "list" "TaskList" NOT NULL DEFAULT 'HOME',
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "memberId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Task_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Event" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "location" TEXT,
  "notes" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "memberId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Chore" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "cadence" TEXT,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "memberId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Chore_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Meal" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "plannedFor" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ShoppingItem" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "quantity" TEXT,
  "store" TEXT,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

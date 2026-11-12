-- CreateEnum
CREATE TYPE "ReminderItemType" AS ENUM ('EVENT', 'TASK');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "reminderMins" INTEGER;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reminderMins" INTEGER;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "itemType" "ReminderItemType" NOT NULL,
    "itemId" INTEGER NOT NULL,
    "occursAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "reminderLeadMins" INTEGER NOT NULL DEFAULT 30,
    "quietStart" TEXT NOT NULL DEFAULT '21:30',
    "quietEnd" TEXT NOT NULL DEFAULT '06:30',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_memberId_endpoint_key" ON "PushSubscription"("memberId", "endpoint");

-- CreateIndex
CREATE INDEX "ReminderLog_sentAt_idx" ON "ReminderLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_memberId_itemType_itemId_occursAt_key" ON "ReminderLog"("memberId", "itemType", "itemId", "occursAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

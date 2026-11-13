-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'DISCUSSING', 'PLANNED', 'DONE', 'PARKED');

-- CreateEnum
CREATE TYPE "IdeaVisibility" AS ENUM ('FAMILY', 'PARENTS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "IdeaEntryKind" AS ENUM ('CONVERSATION', 'NOTE');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "ideaId" INTEGER;

-- CreateTable
CREATE TABLE "Idea" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "shortLine" TEXT NOT NULL,
    "summary" TEXT,
    "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
    "visibility" "IdeaVisibility" NOT NULL DEFAULT 'FAMILY',
    "authorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaEntry" (
    "id" SERIAL NOT NULL,
    "ideaId" INTEGER NOT NULL,
    "kind" "IdeaEntryKind" NOT NULL DEFAULT 'NOTE',
    "authorId" INTEGER,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Idea_status_idx" ON "Idea"("status");

-- CreateIndex
CREATE INDEX "IdeaEntry_ideaId_createdAt_idx" ON "IdeaEntry"("ideaId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaEntry" ADD CONSTRAINT "IdeaEntry_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaEntry" ADD CONSTRAINT "IdeaEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

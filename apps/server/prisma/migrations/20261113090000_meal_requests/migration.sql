-- CreateTable
CREATE TABLE "MealRequest" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "recipeId" INTEGER,
    "memberId" INTEGER,
    "plannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MealRequest" ADD CONSTRAINT "MealRequest_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealRequest" ADD CONSTRAINT "MealRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

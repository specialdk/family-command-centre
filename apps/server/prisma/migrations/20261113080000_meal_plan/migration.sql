-- AlterTable
ALTER TABLE "Meal" ADD COLUMN     "recipeId" INTEGER;

-- AlterTable
ALTER TABLE "ShoppingItem" ADD COLUMN     "aisle" TEXT,
ADD COLUMN     "note" TEXT;

-- AddForeignKey
ALTER TABLE "Meal" ADD CONSTRAINT "Meal_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

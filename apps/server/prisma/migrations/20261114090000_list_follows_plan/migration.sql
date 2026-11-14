-- AlterTable
ALTER TABLE "FamilySetting" ADD COLUMN     "listFrom" TIMESTAMP(3),
ADD COLUMN     "listRecipeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "listTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ShoppingItem" ADD COLUMN     "recipeIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

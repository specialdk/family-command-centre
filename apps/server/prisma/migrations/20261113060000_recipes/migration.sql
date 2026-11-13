-- CreateTable
CREATE TABLE "Recipe" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "ingredients" JSONB NOT NULL,
    "method" JSONB NOT NULL,
    "serves" INTEGER NOT NULL DEFAULT 4,
    "prepMins" INTEGER,
    "cookMins" INTEGER,
    "glutenFree" BOOLEAN NOT NULL DEFAULT false,
    "vegetarian" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'FAMILY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeRating" (
    "id" SERIAL NOT NULL,
    "recipeId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_title_source_key" ON "Recipe"("title", "source");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeRating_recipeId_memberId_key" ON "RecipeRating"("recipeId", "memberId");

-- AddForeignKey
ALTER TABLE "RecipeRating" ADD CONSTRAINT "RecipeRating_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeRating" ADD CONSTRAINT "RecipeRating_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

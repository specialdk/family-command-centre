-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "imageAt" TIMESTAMP(3),
ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageType" TEXT;

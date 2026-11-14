-- CreateTable
CREATE TABLE "ProductPref" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "store" TEXT,
    "aisle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPref_key_key" ON "ProductPref"("key");

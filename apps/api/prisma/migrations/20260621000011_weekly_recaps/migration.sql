-- CreateEnum
CREATE TYPE "RecapStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "recaps" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "videoPath" TEXT,
    "coverPath" TEXT,
    "assetIds" JSONB NOT NULL,
    "photoCount" INTEGER NOT NULL,
    "locationSummary" TEXT,
    "peopleSummary" TEXT,
    "status" "RecapStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recaps_ownerId_weekStart_key" ON "recaps"("ownerId", "weekStart");

-- AddForeignKey
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

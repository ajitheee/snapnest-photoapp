-- Phase 8: Intelligence Foundation

-- Add caption, OCR text, and perceptual hash to assets
ALTER TABLE "assets" ADD COLUMN "caption" TEXT;
ALTER TABLE "assets" ADD COLUMN "ocrText" TEXT;
ALTER TABLE "assets" ADD COLUMN "perceptualHash" TEXT;

-- Add OCR and pHash job status tracking
ALTER TABLE "asset_job_status" ADD COLUMN "ocrDoneAt" TIMESTAMP(3);
ALTER TABLE "asset_job_status" ADD COLUMN "pHashDoneAt" TIMESTAMP(3);

-- Duplicate detection groups
CREATE TABLE "duplicate_groups" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- Index for fast perceptual hash duplicate lookups
CREATE INDEX "assets_perceptualHash_idx" ON "assets" ("perceptualHash") WHERE "perceptualHash" IS NOT NULL;

-- Full-text search index on OCR text
CREATE INDEX "assets_ocrText_idx" ON "assets" USING gin (to_tsvector('english', "ocrText")) WHERE "ocrText" IS NOT NULL;

-- Index for caption search
CREATE INDEX "assets_caption_idx" ON "assets" USING gin (to_tsvector('english', "caption")) WHERE "caption" IS NOT NULL;

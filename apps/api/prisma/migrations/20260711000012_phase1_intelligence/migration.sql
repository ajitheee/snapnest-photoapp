-- Phase 1: Intelligence Foundation
-- Add caption, ocrText, perceptualHash fields to assets

ALTER TABLE "assets" ADD COLUMN "caption" TEXT;
ALTER TABLE "assets" ADD COLUMN "ocrText" TEXT;
ALTER TABLE "assets" ADD COLUMN "perceptualHash" TEXT;

-- Index for duplicate detection by perceptual hash
CREATE INDEX "assets_perceptualHash_idx" ON "assets" ("perceptualHash") WHERE "perceptualHash" IS NOT NULL;

-- Index for full-text search on caption and OCR text
CREATE INDEX "assets_caption_idx" ON "assets" ("ownerId") WHERE "caption" IS NOT NULL;
CREATE INDEX "assets_ocrText_idx" ON "assets" ("ownerId") WHERE "ocrText" IS NOT NULL;

-- Track OCR job completion
ALTER TABLE "asset_job_status" ADD COLUMN "ocrDoneAt" TIMESTAMP(3);
ALTER TABLE "asset_job_status" ADD COLUMN "phashDoneAt" TIMESTAMP(3);

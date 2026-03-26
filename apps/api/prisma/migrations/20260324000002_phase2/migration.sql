-- Phase 2: media processing columns, asset_tags, asset_job_status

-- Add media processing columns to assets
ALTER TABLE "assets"
  ADD COLUMN "thumbnailSmallPath" TEXT,
  ADD COLUMN "thumbnailLargePath" TEXT,
  ADD COLUMN "width"              INTEGER,
  ADD COLUMN "height"             INTEGER,
  ADD COLUMN "duration"           INTEGER,
  ADD COLUMN "exifData"           JSONB,
  ADD COLUMN "locationLat"        DOUBLE PRECISION,
  ADD COLUMN "locationLng"        DOUBLE PRECISION,
  ADD COLUMN "locationCity"       TEXT,
  ADD COLUMN "locationState"      TEXT,
  ADD COLUMN "locationCountry"    TEXT;

-- Drop old unused thumbnail column (replaced by thumbnailSmallPath / thumbnailLargePath)
ALTER TABLE "assets" DROP COLUMN IF EXISTS "thumbnailPath";
ALTER TABLE "assets" DROP COLUMN IF EXISTS "previewPath";

-- Asset tags (scene / object labels from CLIP zero-shot)
CREATE TABLE "asset_tags" (
    "id"         TEXT NOT NULL,
    "assetId"    TEXT NOT NULL,
    "tag"        TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_tags_assetId_tag_key" ON "asset_tags"("assetId", "tag");

ALTER TABLE "asset_tags"
  ADD CONSTRAINT "asset_tags_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Async job tracking per asset
CREATE TABLE "asset_job_status" (
    "assetId"         TEXT NOT NULL,
    "thumbnailDoneAt" TIMESTAMP(3),
    "metadataDoneAt"  TIMESTAMP(3),
    "geocodeDoneAt"   TIMESTAMP(3),
    "transcodeDoneAt" TIMESTAMP(3),
    "clipEmbeddedAt"  TIMESTAMP(3),
    "faceDetectedAt"  TIMESTAMP(3),
    "sceneTaggedAt"   TIMESTAMP(3),
    "faceData"        JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_job_status_pkey" PRIMARY KEY ("assetId")
);

ALTER TABLE "asset_job_status"
  ADD CONSTRAINT "asset_job_status_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

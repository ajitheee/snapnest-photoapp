-- Add photo/video editing columns to assets table.
-- editedPath: S3 key for the saved edited version of the asset.
-- editParams: JSON blob of the last applied edit parameters (for re-editing).

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "editedPath" TEXT;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "editParams" JSONB;

-- Add Apple Live Photo Content Identifier field for automatic HEIC+MOV pairing
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "appleContentId" TEXT;
CREATE INDEX IF NOT EXISTS "assets_appleContentId_idx" ON "assets"("ownerId", "appleContentId") WHERE "appleContentId" IS NOT NULL;

-- Drop the global unique index on checksum so that different users
-- can each upload the same file without a constraint violation.
DROP INDEX IF EXISTS "assets_checksum_key";

-- Create a per-user (ownerId + checksum) unique index so deduplication
-- still works within a single user's library across multiple devices,
-- but two separate users can both own identical files.
CREATE UNIQUE INDEX "assets_owner_checksum_key" ON "assets"("ownerId", "checksum");

-- Phase 3: albums, sharing, trash timestamps, pgvector CLIP embeddings

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add deletedAt timestamp and CLIP embedding to assets
ALTER TABLE "assets"
  ADD COLUMN "deletedAt"      TIMESTAMP(3),
  ADD COLUMN "clipEmbedding"  vector(512);

-- IVFFlat index for fast cosine similarity search
-- (populated once enough assets have embeddings)
CREATE INDEX IF NOT EXISTS "assets_clipEmbedding_idx"
  ON "assets" USING ivfflat ("clipEmbedding" vector_cosine_ops)
  WITH (lists = 100);

-- Albums
CREATE TABLE "albums" (
    "id"           TEXT NOT NULL,
    "ownerId"      TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT,
    "coverAssetId" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "albums_ownerId_idx" ON "albums"("ownerId");

ALTER TABLE "albums"
  ADD CONSTRAINT "albums_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "albums_coverAssetId_fkey"
    FOREIGN KEY ("coverAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Album <-> Asset join table
CREATE TABLE "album_assets" (
    "albumId"  TEXT NOT NULL,
    "assetId"  TEXT NOT NULL,
    "addedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_assets_pkey" PRIMARY KEY ("albumId", "assetId")
);

ALTER TABLE "album_assets"
  ADD CONSTRAINT "album_assets_albumId_fkey"
    FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "album_assets_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Share links
CREATE TABLE "share_links" (
    "id"           TEXT NOT NULL,
    "token"        TEXT NOT NULL,
    "ownerId"      TEXT NOT NULL,
    "albumId"      TEXT,
    "assetId"      TEXT,
    "passwordHash" TEXT,
    "expiresAt"    TIMESTAMP(3),
    "viewCount"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "share_links_token_key" UNIQUE ("token")
);

ALTER TABLE "share_links"
  ADD CONSTRAINT "share_links_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "share_links_albumId_fkey"
    FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "share_links_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

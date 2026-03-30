-- Phase 6: Production hardening

-- Per-user storage quota
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "storageLimitBytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "storageUsedBytes"  BIGINT NOT NULL DEFAULT 0;

-- Make passwordHash nullable for SSO-only accounts
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- OAuth / SSO identity linking
CREATE TABLE IF NOT EXISTS "oauth_identities" (
    "id"                TEXT        NOT NULL,
    "userId"            TEXT        NOT NULL,
    "provider"          TEXT        NOT NULL,
    "providerAccountId" TEXT        NOT NULL,
    "accessToken"       TEXT,
    "refreshToken"      TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_identities_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_identities_provider_account_key"
    ON "oauth_identities"("provider", "providerAccountId");

CREATE INDEX IF NOT EXISTS "oauth_identities_userId_idx"
    ON "oauth_identities"("userId");

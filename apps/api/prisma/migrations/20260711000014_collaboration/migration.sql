-- Phase 9: Family & Collaboration

-- Album contributions flag
ALTER TABLE "albums" ADD COLUMN "allowContributions" BOOLEAN NOT NULL DEFAULT false;

-- Album comments
CREATE TABLE "album_comments" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "assetId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_comments_pkey" PRIMARY KEY ("id")
);

-- Album likes
CREATE TABLE "album_likes" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_likes_pkey" PRIMARY KEY ("id")
);

-- Album activity feed
CREATE TABLE "album_activity" (
    "id" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assetId" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_activity_pkey" PRIMARY KEY ("id")
);

-- Shared libraries (household merged library)
CREATE TABLE "shared_libraries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shared_libraries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_library_members" (
    "id" TEXT NOT NULL,
    "sharedLibraryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_library_members_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "album_comments" ADD CONSTRAINT "album_comments_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_likes" ADD CONSTRAINT "album_likes_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_activity" ADD CONSTRAINT "album_activity_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_library_members" ADD CONSTRAINT "shared_library_members_sharedLibraryId_fkey" FOREIGN KEY ("sharedLibraryId") REFERENCES "shared_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique indexes
CREATE UNIQUE INDEX "album_likes_albumId_assetId_userId_key" ON "album_likes"("albumId", "assetId", "userId");
CREATE UNIQUE INDEX "shared_library_members_sharedLibraryId_userId_key" ON "shared_library_members"("sharedLibraryId", "userId");

-- Phase 2: Organization & Privacy

-- Add hiddenPin to users
ALTER TABLE "users" ADD COLUMN "hiddenPin" TEXT;

-- Album folders
CREATE TABLE "album_folders" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "album_folders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "album_folders" ADD CONSTRAINT "album_folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_folders" ADD CONSTRAINT "album_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "album_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add folder reference and sort order to albums
ALTER TABLE "albums" ADD COLUMN "folderId" TEXT;
ALTER TABLE "albums" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "albums" ADD CONSTRAINT "albums_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "album_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

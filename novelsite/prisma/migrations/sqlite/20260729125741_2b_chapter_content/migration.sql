/*
  Warnings:

  - You are about to drop the column `isFree` on the `Chapter` table. All the data in the column will be lost.
  - Added the required column `novelId` to the `Chapter` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "ChapterContent" (
    "chapterId" TEXT NOT NULL PRIMARY KEY,
    "bodyMarkdown" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChapterContent_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "volumeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" DATETIME,
    CONSTRAINT "Chapter_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chapter_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Chapter" ("id", "number", "publishedAt", "title", "volumeId", "wordCount") SELECT "id", "number", "publishedAt", "title", "volumeId", "wordCount" FROM "Chapter";
DROP TABLE "Chapter";
ALTER TABLE "new_Chapter" RENAME TO "Chapter";
CREATE INDEX "Chapter_volumeId_idx" ON "Chapter"("volumeId");
CREATE INDEX "Chapter_novelId_status_number_idx" ON "Chapter"("novelId", "status", "number");
CREATE UNIQUE INDEX "Chapter_novelId_number_key" ON "Chapter"("novelId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

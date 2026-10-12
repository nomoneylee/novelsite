/*
  Warnings:

  - You are about to drop the column `isLatest` on the `Chapter` table. All the data in the column will be lost.
  - You are about to alter the column `publishedAt` on the `Chapter` table. The data in that column could be lost. The data in that column will be cast from `String` to `DateTime`.
  - You are about to drop the column `author` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `firstChapterId` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `isNew` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `latestChapterId` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `relatedIds` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `releasedAt` on the `Novel` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `Novel` table. All the data in the column will be lost.
  - Added the required column `slug` to the `Category` table without a default value. This is not possible if the table is not empty.
  - Added the required column `authorId` to the `Novel` table without a default value. This is not possible if the table is not empty.
  - Added the required column `categoryId` to the `Novel` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN "penName" TEXT;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "NovelTag" (
    "novelId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("novelId", "tagId"),
    CONSTRAINT "NovelTag_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NovelTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NovelRelation" (
    "novelId" TEXT NOT NULL,
    "relatedNovelId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("novelId", "relatedNovelId"),
    CONSTRAINT "NovelRelation_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NovelRelation_relatedNovelId_fkey" FOREIGN KEY ("relatedNovelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Category" ("bgColor", "color", "description", "emoji", "id", "label", "sortOrder") SELECT "bgColor", "color", "description", "emoji", "id", "label", "sortOrder" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");
CREATE TABLE "new_Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "publishedAt" DATETIME,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "volumeId" TEXT NOT NULL,
    CONSTRAINT "Chapter_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Chapter" ("id", "isFree", "number", "publishedAt", "title", "volumeId", "wordCount") SELECT "id", "isFree", "number", "publishedAt", "title", "volumeId", "wordCount" FROM "Chapter";
DROP TABLE "Chapter";
ALTER TABLE "new_Chapter" RENAME TO "Chapter";
CREATE INDEX "Chapter_volumeId_idx" ON "Chapter"("volumeId");
CREATE TABLE "new_Novel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "cover" TEXT,
    "coverColor" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "chapterCount" INTEGER NOT NULL,
    "rating" REAL NOT NULL,
    "excerpt" TEXT NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "weeklyViews" INTEGER NOT NULL DEFAULT 0,
    "updateFreq" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "serialStatus" TEXT NOT NULL DEFAULT 'ongoing',
    "authorBio" TEXT NOT NULL DEFAULT '',
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Novel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Novel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Novel" ("authorBio", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "rating", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount") SELECT "authorBio", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "rating", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount" FROM "Novel";
DROP TABLE "Novel";
ALTER TABLE "new_Novel" RENAME TO "Novel";
CREATE INDEX "Novel_categoryId_idx" ON "Novel"("categoryId");
CREATE INDEX "Novel_authorId_idx" ON "Novel"("authorId");
CREATE INDEX "Novel_publishedAt_idx" ON "Novel"("publishedAt");
CREATE INDEX "Novel_status_publishedAt_idx" ON "Novel"("status", "publishedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "NovelTag_tagId_idx" ON "NovelTag"("tagId");

-- CreateIndex
CREATE INDEX "NovelRelation_relatedNovelId_idx" ON "NovelRelation"("relatedNovelId");

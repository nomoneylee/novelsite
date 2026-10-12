-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Novel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Novel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Novel" ("authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "serialStatus", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount") SELECT "authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "serialStatus", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount" FROM "Novel";
DROP TABLE "Novel";
ALTER TABLE "new_Novel" RENAME TO "Novel";
CREATE INDEX "Novel_categoryId_idx" ON "Novel"("categoryId");
CREATE INDEX "Novel_authorId_idx" ON "Novel"("authorId");
CREATE INDEX "Novel_publishedAt_idx" ON "Novel"("publishedAt");
CREATE INDEX "Novel_status_publishedAt_idx" ON "Novel"("status", "publishedAt");
CREATE INDEX "Novel_searchText_idx" ON "Novel"("searchText");
CREATE INDEX "Novel_status_updatedAt_idx" ON "Novel"("status", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

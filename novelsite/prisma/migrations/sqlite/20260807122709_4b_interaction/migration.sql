-- CreateTable
CREATE TABLE "ReviewLike" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("reviewId", "userId"),
    CONSTRAINT "ReviewLike_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Comment_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchText" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Novel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Novel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Novel" ("authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "searchText", "serialStatus", "status", "title", "totalViews", "updateFreq", "updatedAt", "weeklyViews", "wordCount") SELECT "authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "searchText", "serialStatus", "status", "title", "totalViews", "updateFreq", "updatedAt", "weeklyViews", "wordCount" FROM "Novel";
DROP TABLE "Novel";
ALTER TABLE "new_Novel" RENAME TO "Novel";
CREATE INDEX "Novel_categoryId_idx" ON "Novel"("categoryId");
CREATE INDEX "Novel_authorId_idx" ON "Novel"("authorId");
CREATE INDEX "Novel_publishedAt_idx" ON "Novel"("publishedAt");
CREATE INDEX "Novel_status_publishedAt_idx" ON "Novel"("status", "publishedAt");
CREATE INDEX "Novel_searchText_idx" ON "Novel"("searchText");
CREATE INDEX "Novel_status_updatedAt_idx" ON "Novel"("status", "updatedAt");
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Review_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- 資料承接：`likes`／`publishedAt` 是**更名**而非重來（data-model.md §3.1 的欄位對應表），
-- 照 Prisma 產生的原句只搬五欄，等於把既有評論的讚數與時間丟掉，且 `updatedAt`
-- 無預設值會直接讓這一步失敗。編輯時刻在此以建立時刻回填（尚未被編輯過）。
INSERT INTO "new_Review" ("content", "id", "novelId", "rating", "userId", "likeCount", "createdAt", "updatedAt") SELECT "content", "id", "novelId", "rating", "userId", "likes", "publishedAt", "publishedAt" FROM "Review";
DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";
CREATE INDEX "Review_novelId_likeCount_id_idx" ON "Review"("novelId", "likeCount", "id");
CREATE INDEX "Review_novelId_createdAt_id_idx" ON "Review"("novelId", "createdAt", "id");
CREATE UNIQUE INDEX "Review_novelId_userId_key" ON "Review"("novelId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ReviewLike_userId_idx" ON "ReviewLike"("userId");

-- CreateIndex
CREATE INDEX "Comment_chapterId_createdAt_idx" ON "Comment"("chapterId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");


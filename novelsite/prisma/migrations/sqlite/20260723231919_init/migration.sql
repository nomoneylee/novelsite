-- CreateTable
CREATE TABLE "Novel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "cover" TEXT,
    "coverColor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "chapterCount" INTEGER NOT NULL,
    "rating" REAL NOT NULL,
    "excerpt" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "weeklyViews" INTEGER NOT NULL DEFAULT 0,
    "updateFreq" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ongoing',
    "authorBio" TEXT NOT NULL DEFAULT '',
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "latestChapterId" TEXT NOT NULL DEFAULT '',
    "firstChapterId" TEXT NOT NULL DEFAULT '',
    "relatedIds" TEXT NOT NULL DEFAULT '',
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Volume" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    CONSTRAINT "Volume_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "publishedAt" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "volumeId" TEXT NOT NULL,
    CONSTRAINT "Chapter_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "avatar" TEXT,
    "avatarColor" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "isHot" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Review_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "RankingEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "novelId" TEXT NOT NULL,
    "change" TEXT,
    "changeCount" INTEGER,
    CONSTRAINT "RankingEntry_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthorNovel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "coverColor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "chapterCount" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "favoriteCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuthorChapterDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "novelTitle" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT 'linear-gradient(135deg,#d97706,#92400e)',
    "role" TEXT NOT NULL DEFAULT 'reader',
    "termsAcceptedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Novel_category_idx" ON "Novel"("category");

-- CreateIndex
CREATE INDEX "Novel_isNew_idx" ON "Novel"("isNew");

-- CreateIndex
CREATE INDEX "Novel_releasedAt_idx" ON "Novel"("releasedAt");

-- CreateIndex
CREATE INDEX "Volume_novelId_idx" ON "Volume"("novelId");

-- CreateIndex
CREATE INDEX "Chapter_volumeId_idx" ON "Chapter"("volumeId");

-- CreateIndex
CREATE INDEX "Review_novelId_idx" ON "Review"("novelId");

-- CreateIndex
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");

-- CreateIndex
CREATE INDEX "RankingEntry_period_idx" ON "RankingEntry"("period");

-- CreateIndex
CREATE UNIQUE INDEX "RankingEntry_period_rank_key" ON "RankingEntry"("period", "rank");

-- CreateIndex
CREATE INDEX "AuthorNovel_status_idx" ON "AuthorNovel"("status");

-- CreateIndex
CREATE INDEX "AuthorChapterDraft_novelId_idx" ON "AuthorChapterDraft"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

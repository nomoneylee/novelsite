-- CreateTable
CREATE TABLE "ChapterView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "userId" TEXT,
    "viewerHash" TEXT NOT NULL,
    "viewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChapterView_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NovelDailyStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "favorites" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "NovelDailyStat_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChapterView_chapterId_viewedAt_idx" ON "ChapterView"("chapterId", "viewedAt");

-- CreateIndex
CREATE INDEX "ChapterView_novelId_viewedAt_idx" ON "ChapterView"("novelId", "viewedAt");

-- CreateIndex
CREATE INDEX "ChapterView_viewerHash_chapterId_idx" ON "ChapterView"("viewerHash", "chapterId");

-- CreateIndex
CREATE INDEX "ChapterView_viewedAt_idx" ON "ChapterView"("viewedAt");

-- CreateIndex
CREATE INDEX "NovelDailyStat_date_idx" ON "NovelDailyStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "NovelDailyStat_novelId_date_key" ON "NovelDailyStat"("novelId", "date");

-- CreateIndex
CREATE INDEX "Novel_weeklyViews_idx" ON "Novel"("weeklyViews");

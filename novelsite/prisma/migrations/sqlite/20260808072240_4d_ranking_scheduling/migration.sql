-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN "scheduledAt" DATETIME;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RankingEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "period" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "categoryId" TEXT NOT NULL DEFAULT 'all',
    "novelId" TEXT NOT NULL,
    "change" TEXT,
    "changeCount" INTEGER,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RankingEntry_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RankingEntry" ("change", "changeCount", "id", "novelId", "period", "rank") SELECT "change", "changeCount", "id", "novelId", "period", "rank" FROM "RankingEntry";
DROP TABLE "RankingEntry";
ALTER TABLE "new_RankingEntry" RENAME TO "RankingEntry";
CREATE INDEX "RankingEntry_period_categoryId_rank_idx" ON "RankingEntry"("period", "categoryId", "rank");
CREATE UNIQUE INDEX "RankingEntry_period_categoryId_rank_key" ON "RankingEntry"("period", "categoryId", "rank");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Chapter_status_scheduledAt_idx" ON "Chapter"("status", "scheduledAt");

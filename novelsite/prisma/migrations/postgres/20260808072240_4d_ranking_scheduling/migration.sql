-- DropIndex
DROP INDEX "RankingEntry_period_idx";

-- DropIndex
DROP INDEX "RankingEntry_period_rank_key";

-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RankingEntry" ADD COLUMN     "categoryId" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Chapter_status_scheduledAt_idx" ON "Chapter"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "RankingEntry_period_categoryId_rank_idx" ON "RankingEntry"("period", "categoryId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingEntry_period_categoryId_rank_key" ON "RankingEntry"("period", "categoryId", "rank");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

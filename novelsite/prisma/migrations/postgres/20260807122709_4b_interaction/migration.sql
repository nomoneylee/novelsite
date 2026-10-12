-- DropIndex
DROP INDEX "Review_novelId_idx";

-- AlterTable
ALTER TABLE "Novel" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
-- 新欄先加、資料承接、舊欄後刪：`likes`／`publishedAt` 是**更名**而非重來
-- （data-model.md §3.1 的欄位對應表），照 Prisma 產生的原句一次 DROP 加 ADD，
-- 既有評論的讚數與時間會被丟掉，且 `updatedAt` 無預設值會直接讓這一步失敗。
ALTER TABLE "Review" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'visible',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Review" SET "likeCount" = "likes", "createdAt" = "publishedAt", "updatedAt" = "publishedAt";

-- `@updatedAt` 由客戶端寫入，最終狀態無資料庫預設值（僅回填期間暫時給一個）
ALTER TABLE "Review" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Review" DROP COLUMN "isHot",
DROP COLUMN "likes",
DROP COLUMN "publishedAt";

-- CreateTable
CREATE TABLE "ReviewLike" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLike_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewLike_userId_idx" ON "ReviewLike"("userId");

-- CreateIndex
CREATE INDEX "Comment_chapterId_createdAt_idx" ON "Comment"("chapterId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");

-- CreateIndex
CREATE INDEX "Review_novelId_likeCount_id_idx" ON "Review"("novelId", "likeCount", "id");

-- CreateIndex
CREATE INDEX "Review_novelId_createdAt_id_idx" ON "Review"("novelId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Review_novelId_userId_key" ON "Review"("novelId", "userId");

-- AddForeignKey
ALTER TABLE "ReviewLike" ADD CONSTRAINT "ReviewLike_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLike" ADD CONSTRAINT "ReviewLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


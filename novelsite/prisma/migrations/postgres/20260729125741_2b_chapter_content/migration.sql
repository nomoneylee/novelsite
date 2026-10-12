-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "isFree",
ADD COLUMN     "novelId" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE "ChapterContent" (
    "chapterId" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterContent_pkey" PRIMARY KEY ("chapterId")
);

-- CreateIndex
CREATE INDEX "Chapter_novelId_status_number_idx" ON "Chapter"("novelId", "status", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_novelId_number_key" ON "Chapter"("novelId", "number");

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterContent" ADD CONSTRAINT "ChapterContent_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX "Novel_category_idx";

-- DropIndex
DROP INDEX "Novel_isNew_idx";

-- DropIndex
DROP INDEX "Novel_releasedAt_idx";

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "slug" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "isLatest",
DROP COLUMN "publishedAt",
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Novel" DROP COLUMN "author",
DROP COLUMN "category",
DROP COLUMN "firstChapterId",
DROP COLUMN "isNew",
DROP COLUMN "latestChapterId",
DROP COLUMN "relatedIds",
DROP COLUMN "releasedAt",
DROP COLUMN "tags",
ADD COLUMN     "authorId" TEXT NOT NULL,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "serialStatus" TEXT NOT NULL DEFAULT 'ongoing',
ALTER COLUMN "status" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "penName" TEXT;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovelTag" (
    "novelId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "NovelTag_pkey" PRIMARY KEY ("novelId","tagId")
);

-- CreateTable
CREATE TABLE "NovelRelation" (
    "novelId" TEXT NOT NULL,
    "relatedNovelId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NovelRelation_pkey" PRIMARY KEY ("novelId","relatedNovelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "NovelTag_tagId_idx" ON "NovelTag"("tagId");

-- CreateIndex
CREATE INDEX "NovelRelation_relatedNovelId_idx" ON "NovelRelation"("relatedNovelId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Novel_categoryId_idx" ON "Novel"("categoryId");

-- CreateIndex
CREATE INDEX "Novel_authorId_idx" ON "Novel"("authorId");

-- CreateIndex
CREATE INDEX "Novel_publishedAt_idx" ON "Novel"("publishedAt");

-- CreateIndex
CREATE INDEX "Novel_status_publishedAt_idx" ON "Novel"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "Novel" ADD CONSTRAINT "Novel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Novel" ADD CONSTRAINT "Novel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelTag" ADD CONSTRAINT "NovelTag_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelTag" ADD CONSTRAINT "NovelTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelRelation" ADD CONSTRAINT "NovelRelation_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelRelation" ADD CONSTRAINT "NovelRelation_relatedNovelId_fkey" FOREIGN KEY ("relatedNovelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

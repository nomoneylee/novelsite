-- AlterTable
ALTER TABLE "Review" DROP COLUMN "author",
DROP COLUMN "avatar",
DROP COLUMN "avatarColor",
ADD COLUMN     "userId" TEXT NOT NULL,
DROP COLUMN "publishedAt",
ADD COLUMN     "publishedAt" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "AuthorChapterDraft";

-- DropTable
DROP TABLE "AuthorNovel";

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

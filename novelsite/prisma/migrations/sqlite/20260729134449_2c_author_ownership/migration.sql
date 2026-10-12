/*
  Warnings:

  - You are about to drop the `AuthorChapterDraft` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuthorNovel` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `author` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `avatar` on the `Review` table. All the data in the column will be lost.
  - You are about to drop the column `avatarColor` on the `Review` table. All the data in the column will be lost.
  - You are about to alter the column `publishedAt` on the `Review` table. The data in that column could be lost. The data in that column will be cast from `String` to `DateTime`.
  - Added the required column `userId` to the `Review` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AuthorChapterDraft_novelId_idx";

-- DropIndex
DROP INDEX "AuthorNovel_status_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AuthorChapterDraft";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AuthorNovel";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "novelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "isHot" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Review_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Review" ("content", "id", "isHot", "likes", "novelId", "publishedAt", "rating") SELECT "content", "id", "isHot", "likes", "novelId", "publishedAt", "rating" FROM "Review";
DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";
CREATE INDEX "Review_novelId_idx" ON "Review"("novelId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

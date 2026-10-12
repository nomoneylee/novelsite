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
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Novel_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Novel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Novel" ("authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "serialStatus", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount") SELECT "authorId", "categoryId", "chapterCount", "commentCount", "cover", "coverColor", "description", "excerpt", "favoriteCount", "id", "isFeatured", "publishedAt", "rating", "serialStatus", "status", "title", "totalViews", "updateFreq", "weeklyViews", "wordCount" FROM "Novel";
DROP TABLE "Novel";
ALTER TABLE "new_Novel" RENAME TO "Novel";
CREATE INDEX "Novel_categoryId_idx" ON "Novel"("categoryId");
CREATE INDEX "Novel_authorId_idx" ON "Novel"("authorId");
CREATE INDEX "Novel_publishedAt_idx" ON "Novel"("publishedAt");
CREATE INDEX "Novel_status_publishedAt_idx" ON "Novel"("status", "publishedAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL DEFAULT 'linear-gradient(135deg,#d97706,#92400e)',
    "role" TEXT NOT NULL DEFAULT 'reader',
    "penName" TEXT,
    "bio" TEXT NOT NULL DEFAULT '',
    "termsAcceptedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("avatarColor", "createdAt", "email", "id", "name", "passwordHash", "penName", "role", "termsAcceptedAt", "updatedAt") SELECT "avatarColor", "createdAt", "email", "id", "name", "passwordHash", "penName", "role", "termsAcceptedAt", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Volume_novelId_number_key" ON "Volume"("novelId", "number");

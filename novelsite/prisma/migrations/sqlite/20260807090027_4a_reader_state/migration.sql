-- CreateTable
CREATE TABLE "Bookshelf" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bookshelf_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bookshelf_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookshelfEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookshelfEvent_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReadingProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReadingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReadingProgress_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReadingHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReadingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReadingHistory_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReaderPreference" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "fontSize" TEXT NOT NULL DEFAULT 'md',
    "theme" TEXT NOT NULL DEFAULT 'light',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReaderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bookshelf_userId_createdAt_idx" ON "Bookshelf"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Bookshelf_novelId_idx" ON "Bookshelf"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "Bookshelf_userId_novelId_key" ON "Bookshelf"("userId", "novelId");

-- CreateIndex
CREATE INDEX "BookshelfEvent_novelId_createdAt_idx" ON "BookshelfEvent"("novelId", "createdAt");

-- CreateIndex
CREATE INDEX "BookshelfEvent_createdAt_idx" ON "BookshelfEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ReadingProgress_userId_updatedAt_idx" ON "ReadingProgress"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingProgress_userId_novelId_key" ON "ReadingProgress"("userId", "novelId");

-- CreateIndex
CREATE INDEX "ReadingHistory_userId_readAt_idx" ON "ReadingHistory"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingHistory_userId_novelId_key" ON "ReadingHistory"("userId", "novelId");

-- AlterTable
ALTER TABLE "Novel" DROP COLUMN "authorBio";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Volume_novelId_number_key" ON "Volume"("novelId", "number");

-- DropForeignKey
ALTER TABLE "Card" DROP CONSTRAINT "Card_chapterId_fkey";

-- AlterTable
ALTER TABLE "Card" ALTER COLUMN "title" DROP DEFAULT,
ALTER COLUMN "recast" DROP DEFAULT,
ALTER COLUMN "boundaries" DROP DEFAULT;

-- CreateTable
CREATE TABLE "UserCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL DEFAULT '',
    "sourceAuthor" TEXT NOT NULL DEFAULT '',
    "module" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "recast" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "boundaries" TEXT[],
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserCard_userId_createdAt_idx" ON "UserCard"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCard" ADD CONSTRAINT "UserCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

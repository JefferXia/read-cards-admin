-- Card 直属书 + 章节可空（非公版书卡片不绑定章节）
ALTER TABLE "Card" ADD COLUMN "bookId" TEXT;

-- 存量卡：bookId 取自所属章节
UPDATE "Card" SET "bookId" = (
  SELECT ch."bookId" FROM "Chapter" ch WHERE ch."id" = "Card"."chapterId"
);

ALTER TABLE "Card" ALTER COLUMN "bookId" SET NOT NULL;
ALTER TABLE "Card" ALTER COLUMN "chapterId" DROP NOT NULL;

CREATE INDEX "Card_bookId_sortOrder_idx" ON "Card"("bookId", "sortOrder");
ALTER TABLE "Card" ADD CONSTRAINT "Card_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

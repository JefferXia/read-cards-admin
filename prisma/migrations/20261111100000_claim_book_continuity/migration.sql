-- 书单连续性：每日领取记录领取时锁定的书目
-- 规则：前一本未读完（仍有未学 APPROVED 卡）则逐日续读，读完才进入新的全局活跃书
ALTER TABLE "DailyClaim" ADD COLUMN "bookId" TEXT;

-- 书被归档/删除时不连带删领取记录（置空即可，选书逻辑会回退到活跃书）
ALTER TABLE "DailyClaim" ADD CONSTRAINT "DailyClaim_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

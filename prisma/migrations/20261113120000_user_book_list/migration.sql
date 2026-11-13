-- 书单表：记录用户触达过的书（领取打卡、刷新书单都写入/刷新一条）。
-- 按最近触达时间排序，最新一条即「当前书单」：领取/今日卡/书详情优先跟随它，
-- 读完（无未学卡）自动落回领取链 / 全局活跃书；同时天然形成该用户的书单列表。
CREATE TABLE "UserBook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBook_pkey" PRIMARY KEY ("id")
);

-- 每用户每书一条：重复触达只刷新 updatedAt
CREATE UNIQUE INDEX "UserBook_userId_bookId_key" ON "UserBook"("userId", "bookId");
-- 当前书单 = 该用户 updatedAt 最新的一条
CREATE INDEX "UserBook_userId_updatedAt_idx" ON "UserBook"("userId", "updatedAt");

ALTER TABLE "UserBook" ADD CONSTRAINT "UserBook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBook" ADD CONSTRAINT "UserBook_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

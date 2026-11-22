-- Book.sortOrder：发现页展示顺序（admin 书单可调；0 = 未指定，按书名兜底）
ALTER TABLE "Book" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

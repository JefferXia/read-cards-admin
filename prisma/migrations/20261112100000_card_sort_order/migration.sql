-- Card.sortOrder：全局展示顺序（入库递增序，与章节解耦）
ALTER TABLE "Card" ADD COLUMN "sortOrder" INTEGER;
CREATE SEQUENCE "Card_sortOrder_seq" OWNED BY "Card"."sortOrder";
ALTER TABLE "Card" ALTER COLUMN "sortOrder" SET DEFAULT nextval('"Card_sortOrder_seq"');
-- 存量卡按物理行序预填序号（随后 backfill 脚本会按数据源 JSON 顺序重写）
UPDATE "Card" SET "sortOrder" = nextval('"Card_sortOrder_seq"');
ALTER TABLE "Card" ALTER COLUMN "sortOrder" SET NOT NULL;

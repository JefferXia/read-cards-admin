-- 自建卡分型：书卡（BOOK，完整 SQ3R）/ 认知卡（COGNITION，仅 module+标题）
-- AlterTable
ALTER TABLE "UserCard" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BOOK';

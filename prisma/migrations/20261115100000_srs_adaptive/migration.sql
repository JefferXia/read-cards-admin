-- 自适应复习（方案 A）：CardState 加排程字段 + 新增 MASTERED 阶段
-- AlterTable
ALTER TABLE "CardState" ADD COLUMN "reps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "tier2Count" INTEGER NOT NULL DEFAULT 0;

-- AlterEnum（新增枚举值不能与其使用同事务，Prisma 会拆分执行）
ALTER TYPE "CardPhase" ADD VALUE 'MASTERED';

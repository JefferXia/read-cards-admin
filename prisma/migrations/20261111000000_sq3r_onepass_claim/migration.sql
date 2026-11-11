-- v2：SQ3R 卡片结构 + 一遍式复习 + 每日领取
-- 重命名保留数据；SM-2 / 对谈（DialogSession）下线删除

-- ============ Card：SQ3R 字段 ============
-- 重命名（保留原数据）
ALTER TABLE "Card" RENAME COLUMN "statement" TO "definition";
ALTER TABLE "Card" RENAME COLUMN "surface" TO "quote";
ALTER TABLE "Card" RENAME COLUMN "question" TO "trigger";
ALTER TABLE "Card" RENAME COLUMN "sourceRef" TO "source";

-- 新增：卡名 / 重构阐释 / 边界（旧行先给空值默认）
ALTER TABLE "Card" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Card" ADD COLUMN "recast" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Card" ADD COLUMN "boundaries" TEXT[] NOT NULL DEFAULT '{}';

-- 删除：命中信号（改由 AI 直接判复述）
ALTER TABLE "Card" DROP COLUMN "signals";

-- ============ Book：副题 / 推荐语 ============
ALTER TABLE "Book" ADD COLUMN "subtitle" TEXT;
ALTER TABLE "Book" ADD COLUMN "tagline" TEXT;

-- ============ CardState：删 SM-2，加复习结果 ============
ALTER TABLE "CardState" DROP COLUMN "ease";
ALTER TABLE "CardState" DROP COLUMN "intervalDays";
ALTER TABLE "CardState" DROP COLUMN "reps";
ALTER TABLE "CardState" DROP COLUMN "lapses";
ALTER TABLE "CardState" DROP COLUMN "lastGrade";

ALTER TABLE "CardState" ADD COLUMN "score" INTEGER;
ALTER TABLE "CardState" ADD COLUMN "tier" INTEGER;
ALTER TABLE "CardState" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CardPhase：去掉 REVIEW，新增 DONE（旧 REVIEW 视作尚未复习 → NEW）
ALTER TABLE "CardState" ALTER COLUMN "phase" DROP DEFAULT;
ALTER TABLE "CardState" ALTER COLUMN "phase" TYPE TEXT USING "phase"::text;
DROP TYPE "CardPhase";
CREATE TYPE "CardPhase" AS ENUM ('NEW', 'DONE', 'SUSPENDED');
ALTER TABLE "CardState" ALTER COLUMN "phase" TYPE "CardPhase"
  USING (CASE WHEN "phase" = 'REVIEW' THEN 'NEW' ELSE "phase" END)::"CardPhase";
ALTER TABLE "CardState" ALTER COLUMN "phase" SET DEFAULT 'NEW';

-- ============ DialogSession：对谈式复习下线 ============
DROP TABLE "DialogSession";
DROP TYPE "SessionType";
DROP TYPE "SessionStatus";

-- ============ DailyClaim：每日领取（打卡 + 困惑） ============
CREATE TABLE "DailyClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimDate" TEXT NOT NULL,
    "confusion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyClaim_userId_claimDate_key" ON "DailyClaim"("userId", "claimDate");

ALTER TABLE "DailyClaim" ADD CONSTRAINT "DailyClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

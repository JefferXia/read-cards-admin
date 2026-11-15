-- 自建认知卡统一：UserCard 瘦身（去 kind/definition/trigger/boundaries/source），CardState 支持自建卡入册
-- DropTable
ALTER TABLE "UserCard" DROP COLUMN IF EXISTS "kind",
DROP COLUMN IF EXISTS "definition",
DROP COLUMN IF EXISTS "trigger",
DROP COLUMN IF EXISTS "boundaries",
DROP COLUMN IF EXISTS "source";

-- CardState 支持自建卡：cardId 可空 + userCardId 新列（自删卡级联删除复习状态）
ALTER TABLE "CardState" ALTER COLUMN "cardId" DROP NOT NULL;
ALTER TABLE "CardState" ADD COLUMN "userCardId" TEXT;
ALTER TABLE "CardState" ADD CONSTRAINT "CardState_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 自建卡入册唯一（每用户每张自建卡一条复习状态）
CREATE UNIQUE INDEX "CardState_userId_userCardId_key" ON "CardState"("userId", "userCardId");

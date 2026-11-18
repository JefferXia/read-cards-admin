-- UserCard 朗读音频：首次点播放时按需合成（朗读 recast 文本）→ 转存 Vercel Blob → 回写
-- 与 Card.audioUrl 一致：不做批量预生成，用户自己触发
ALTER TABLE "UserCard" ADD COLUMN "audioUrl" TEXT;
ALTER TABLE "UserCard" ADD COLUMN "audioMs" INTEGER;

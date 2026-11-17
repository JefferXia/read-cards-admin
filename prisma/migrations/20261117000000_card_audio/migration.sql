-- Card 朗读音频：TTS（MiniMax speech-2.8-hd）合成后转存 Vercel Blob 的地址与时长
-- 按需生成：首次点播放合成并回写，之后直读库返回
ALTER TABLE "Card" ADD COLUMN "audioUrl" TEXT;
ALTER TABLE "Card" ADD COLUMN "audioMs" INTEGER;

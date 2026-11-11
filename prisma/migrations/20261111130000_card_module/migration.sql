-- 卡片增加技能分类 module（知命/改过/辨善/守谦/践行；跨章节的能力主题）
ALTER TABLE "Card" ADD COLUMN "module" TEXT NOT NULL DEFAULT '';

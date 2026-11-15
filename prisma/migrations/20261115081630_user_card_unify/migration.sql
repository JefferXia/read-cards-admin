-- DropForeignKey
ALTER TABLE "CardState" DROP CONSTRAINT "CardState_cardId_fkey";

-- AddForeignKey
ALTER TABLE "CardState" ADD CONSTRAINT "CardState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

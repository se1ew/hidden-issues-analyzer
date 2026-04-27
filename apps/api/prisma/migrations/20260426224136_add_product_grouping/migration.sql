-- AlterTable
ALTER TABLE "HiddenIssue" ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "HiddenIssue_productId_idx" ON "HiddenIssue"("productId");

-- AddForeignKey
ALTER TABLE "HiddenIssue" ADD CONSTRAINT "HiddenIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

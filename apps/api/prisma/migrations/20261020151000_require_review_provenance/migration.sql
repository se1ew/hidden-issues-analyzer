BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Review" r LEFT JOIN "UploadBatch" b ON b.id = r."uploadBatchId"
    WHERE r."productId" IS NULL OR r."uploadBatchId" IS NULL OR b."productId" IS DISTINCT FROM r."productId") THEN
    RAISE EXCEPTION 'Explicitly link legacy reviews to their verified product and first import before applying the provenance migration; see scripts/link-legacy-review.mjs';
  END IF;
END $$;
ALTER TABLE "Review" ALTER COLUMN "productId" SET NOT NULL, ALTER COLUMN "uploadBatchId" SET NOT NULL;
ALTER TABLE "Review" DROP CONSTRAINT "Review_productId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "UploadBatch_id_productId_key" ON "UploadBatch"(id, "productId");
ALTER TABLE "Review" DROP CONSTRAINT "Review_uploadBatchId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_uploadBatchId_productId_fkey" FOREIGN KEY ("uploadBatchId", "productId") REFERENCES "UploadBatch"(id, "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;

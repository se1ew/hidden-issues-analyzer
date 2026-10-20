ALTER TABLE "UploadBatch" ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "processedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "errorCode" TEXT;
CREATE UNIQUE INDEX "UploadBatch_userId_idempotencyKey_key" ON "UploadBatch"("userId", "idempotencyKey");

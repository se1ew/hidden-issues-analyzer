CREATE TABLE "ExtractionCache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "result" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExtractionCache_expiresAt_idx" ON "ExtractionCache"("expiresAt");

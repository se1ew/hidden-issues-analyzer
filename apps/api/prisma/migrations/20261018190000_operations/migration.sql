CREATE TYPE "ReportStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'expired');
ALTER TABLE "Report" ADD COLUMN "status" "ReportStatus" NOT NULL DEFAULT 'completed',
 ADD COLUMN "errorCode" TEXT, ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "startedAt" TIMESTAMP(3), ADD COLUMN "finishedAt" TIMESTAMP(3), ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
CREATE INDEX "Report_status_createdAt_idx" ON "Report" ("status", "createdAt");
CREATE TABLE "ServiceHeartbeat" ("id" TEXT PRIMARY KEY, "role" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "ServiceHeartbeat_role_expiresAt_idx" ON "ServiceHeartbeat" ("role", "expiresAt");

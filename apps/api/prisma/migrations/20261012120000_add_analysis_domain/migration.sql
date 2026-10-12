BEGIN;

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('legacy', 'pending', 'running', 'completed', 'partial', 'failed', 'interrupted');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted');

-- CreateEnum
CREATE TYPE "AnalysisStage" AS ENUM ('preparation', 'extraction', 'grouping', 'persistence');

-- CreateEnum
CREATE TYPE "ReviewAnalysisStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('new', 'confirmed', 'rejected', 'resolved');

-- CreateEnum
CREATE TYPE "AspectCategory" AS ENUM ('quality', 'functionality', 'material', 'size_fit', 'appearance', 'usability', 'price', 'delivery', 'seller', 'packaging', 'other');

-- CreateEnum
CREATE TYPE "IssueScope" AS ENUM ('product', 'delivery', 'seller', 'packaging');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "authorExternalId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "inputVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "legacyAnalysis" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "uploadBatchId" TEXT;

-- AlterTable
ALTER TABLE "HiddenIssue" ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "UploadBatch" ADD COLUMN     "addedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "diagnostics" JSONB,
ADD COLUMN     "errorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "skippedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ImportStatus" NOT NULL DEFAULT 'legacy';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "artifactKey" TEXT,
ADD COLUMN     "legacy" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "parameters" JSONB,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "sizeBytes" BIGINT;

-- CreateTable
CREATE TABLE "ReviewImportOccurrence" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "uploadBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewImportOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "previousRunId" TEXT,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'queued',
    "stage" "AnalysisStage" NOT NULL DEFAULT 'preparation',
    "scope" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "methodVersion" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "finishReason" TEXT,
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromStatus" "AnalysisRunStatus",
    "toStatus" "AnalysisRunStatus" NOT NULL,
    "initiator" TEXT NOT NULL,
    "reason" TEXT,
    "stateVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunReview" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "reviewId" TEXT,
    "sourceReviewId" TEXT NOT NULL,
    "inputVersion" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rating" INTEGER,
    "reviewDate" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "authorExternalId" TEXT,
    "uploadBatchId" TEXT,

    CONSTRAINT "AnalysisRunReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAnalysis" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runReviewId" TEXT NOT NULL,
    "status" "ReviewAnalysisStatus" NOT NULL DEFAULT 'pending',
    "sentiment" "Sentiment",
    "sentimentScore" DOUBLE PRECISION,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "tokenUsage" JSONB,
    "errorCode" TEXT,
    "diagnostics" JSONB,
    "rawResponse" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AspectMention" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "category" "AspectCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "sentiment" "Sentiment" NOT NULL,

    CONSTRAINT "AspectMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueMention" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "aspectId" TEXT NOT NULL,
    "scope" "IssueScope" NOT NULL,
    "defect" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "quoteStart" INTEGER NOT NULL,
    "quoteEnd" INTEGER NOT NULL,
    "consequences" TEXT,

    CONSTRAINT "IssueMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProblemStatus" NOT NULL DEFAULT 'new',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemEvent" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "fromStatus" "ProblemStatus",
    "toStatus" "ProblemStatus" NOT NULL,
    "reason" TEXT,
    "initiator" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueClusterSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "problemId" TEXT,
    "title" TEXT NOT NULL,
    "defect" TEXT NOT NULL,
    "scope" "IssueScope" NOT NULL,
    "category" "AspectCategory" NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewCount" INTEGER NOT NULL,
    "positiveContextCount" INTEGER NOT NULL,
    "analyzedCount" INTEGER NOT NULL,
    "severity" DOUBLE PRECISION,
    "visibility" DOUBLE PRECISION,
    "hiddenScore" DOUBLE PRECISION,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueClusterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueClusterMember" (
    "runId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "issueMentionId" TEXT NOT NULL,

    CONSTRAINT "IssueClusterMember_pkey" PRIMARY KEY ("clusterId","issueMentionId")
);

-- CreateIndex
CREATE INDEX "ReviewImportOccurrence_uploadBatchId_idx" ON "ReviewImportOccurrence"("uploadBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewImportOccurrence_reviewId_uploadBatchId_key" ON "ReviewImportOccurrence"("reviewId", "uploadBatchId");

-- CreateIndex
CREATE INDEX "AnalysisRun_userId_createdAt_idx" ON "AnalysisRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_productId_status_createdAt_idx" ON "AnalysisRun"("productId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRun_id_productId_key" ON "AnalysisRun"("id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRunEvent_runId_stateVersion_key" ON "AnalysisRunEvent"("runId", "stateVersion");

-- CreateIndex
CREATE INDEX "AnalysisRunReview_reviewId_idx" ON "AnalysisRunReview"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRunReview_runId_sourceReviewId_key" ON "AnalysisRunReview"("runId", "sourceReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRunReview_runId_id_key" ON "AnalysisRunReview"("runId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnalysis_runReviewId_key" ON "ReviewAnalysis"("runReviewId");

-- CreateIndex
CREATE INDEX "ReviewAnalysis_runId_status_idx" ON "ReviewAnalysis"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnalysis_runId_runReviewId_key" ON "ReviewAnalysis"("runId", "runReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAnalysis_runId_id_key" ON "ReviewAnalysis"("runId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AspectMention_analysisId_id_key" ON "AspectMention"("analysisId", "id");

-- CreateIndex
CREATE INDEX "IssueMention_analysisId_idx" ON "IssueMention"("analysisId");

-- CreateIndex
CREATE INDEX "IssueMention_aspectId_idx" ON "IssueMention"("aspectId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueMention_runId_id_key" ON "IssueMention"("runId", "id");

-- CreateIndex
CREATE INDEX "Problem_productId_status_idx" ON "Problem"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_id_productId_key" ON "Problem"("id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemEvent_problemId_stateVersion_key" ON "ProblemEvent"("problemId", "stateVersion");

-- CreateIndex
CREATE INDEX "IssueClusterSnapshot_problemId_idx" ON "IssueClusterSnapshot"("problemId");

-- CreateIndex
CREATE INDEX "IssueClusterSnapshot_productId_runId_idx" ON "IssueClusterSnapshot"("productId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueClusterSnapshot_runId_id_key" ON "IssueClusterSnapshot"("runId", "id");

-- CreateIndex
CREATE INDEX "IssueClusterMember_issueMentionId_idx" ON "IssueClusterMember"("issueMentionId");

-- CreateIndex
CREATE INDEX "Product_userId_createdAt_idx" ON "Product"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_userId_key" ON "Product"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_userId_source_externalId_key" ON "Product"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "Review_uploadBatchId_idx" ON "Review"("uploadBatchId");

-- CreateIndex
CREATE INDEX "Review_productId_reviewDate_idx" ON "Review"("productId", "reviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "Review_productId_source_externalId_key" ON "Review"("productId", "source", "externalId");

-- CreateIndex
CREATE INDEX "UploadBatch_productId_status_idx" ON "UploadBatch"("productId", "status");

-- CreateIndex
CREATE INDEX "Report_productId_runId_idx" ON "Report"("productId", "runId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_productId_userId_fkey" FOREIGN KEY ("productId", "userId") REFERENCES "Product"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_productId_userId_fkey" FOREIGN KEY ("productId", "userId") REFERENCES "Product"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_runId_productId_fkey" FOREIGN KEY ("runId", "productId") REFERENCES "AnalysisRun"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImportOccurrence" ADD CONSTRAINT "ReviewImportOccurrence_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImportOccurrence" ADD CONSTRAINT "ReviewImportOccurrence_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_productId_userId_fkey" FOREIGN KEY ("productId", "userId") REFERENCES "Product"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_previousRunId_productId_fkey" FOREIGN KEY ("previousRunId", "productId") REFERENCES "AnalysisRun"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunEvent" ADD CONSTRAINT "AnalysisRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunReview" ADD CONSTRAINT "AnalysisRunReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRunReview" ADD CONSTRAINT "AnalysisRunReview_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAnalysis" ADD CONSTRAINT "ReviewAnalysis_runId_runReviewId_fkey" FOREIGN KEY ("runId", "runReviewId") REFERENCES "AnalysisRunReview"("runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AspectMention" ADD CONSTRAINT "AspectMention_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ReviewAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_runId_analysisId_fkey" FOREIGN KEY ("runId", "analysisId") REFERENCES "ReviewAnalysis"("runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_analysisId_aspectId_fkey" FOREIGN KEY ("analysisId", "aspectId") REFERENCES "AspectMention"("analysisId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemEvent" ADD CONSTRAINT "ProblemEvent_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemEvent" ADD CONSTRAINT "ProblemEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueClusterSnapshot" ADD CONSTRAINT "IssueClusterSnapshot_runId_productId_fkey" FOREIGN KEY ("runId", "productId") REFERENCES "AnalysisRun"("id", "productId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueClusterSnapshot" ADD CONSTRAINT "IssueClusterSnapshot_problemId_productId_fkey" FOREIGN KEY ("problemId", "productId") REFERENCES "Problem"("id", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueClusterMember" ADD CONSTRAINT "IssueClusterMember_runId_clusterId_fkey" FOREIGN KEY ("runId", "clusterId") REFERENCES "IssueClusterSnapshot"("runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueClusterMember" ADD CONSTRAINT "IssueClusterMember_runId_issueMentionId_fkey" FOREIGN KEY ("runId", "issueMentionId") REFERENCES "IssueMention"("runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve known import times; do not invent links to historical batches or quotes.
UPDATE "Review" SET "importedAt" = "createdAt",
    "legacyAnalysis" = ("analyzedAt" IS NOT NULL OR "sentiment" IS NOT NULL
                        OR "aspects" IS NOT NULL OR "issues" IS NOT NULL
                        OR "hiddenIssueId" IS NOT NULL);
UPDATE "UploadBatch" SET "addedCount" = "count",
    "diagnostics" = '{"provenance":"legacy_unlinked","countsVerified":false}'::jsonb;

-- These PostgreSQL constraints are intentionally maintained in SQL.
CREATE UNIQUE INDEX "AnalysisRun_one_active_per_product"
ON "AnalysisRun" ("productId") WHERE "status" IN ('queued', 'running');
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_valid_counts"
CHECK ("total" >= 0 AND "succeeded" >= 0 AND "failed" >= 0 AND "succeeded" + "failed" <= "total");
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_valid_completed"
CHECK ("status" <> 'completed' OR ("succeeded" = "total" AND "failed" = 0 AND "finishedAt" IS NOT NULL));
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_valid_counts"
CHECK ("count" >= 0 AND "addedCount" >= 0 AND "skippedCount" >= 0 AND "errorCount" >= 0);
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_owned_product"
CHECK ("productId" IS NULL OR "userId" IS NOT NULL);
ALTER TABLE "Report" ADD CONSTRAINT "Report_owned_product"
CHECK (("productId" IS NULL OR "userId" IS NOT NULL) AND ("runId" IS NULL OR "productId" IS NOT NULL));
ALTER TABLE "Report" ADD CONSTRAINT "Report_complete_metadata"
CHECK ("legacy" OR ("productId" IS NOT NULL AND "runId" IS NOT NULL AND "parameters" IS NOT NULL AND "artifactKey" IS NOT NULL));
ALTER TABLE "AnalysisRunReview" ADD CONSTRAINT "AnalysisRunReview_valid_input"
CHECK ("inputVersion" >= 1 AND ("rating" IS NULL OR "rating" BETWEEN 1 AND 5));
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_valid_quote_range"
CHECK ("quoteStart" >= 0 AND "quoteEnd" > "quoteStart" AND length("quote") > 0);
ALTER TABLE "IssueClusterSnapshot" ADD CONSTRAINT "IssueClusterSnapshot_valid_counts"
CHECK ("analyzedCount" >= "reviewCount" AND "reviewCount" >= "positiveContextCount" AND "positiveContextCount" >= 0);

-- Source deletion may clear reviewId; the frozen input must remain unchanged.
CREATE FUNCTION "protect_analysis_input"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'reviewId') IS DISTINCT FROM (to_jsonb(OLD) - 'reviewId')
     OR (NEW."reviewId" IS DISTINCT FROM OLD."reviewId" AND NEW."reviewId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Analysis input snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AnalysisRunReview_immutable" BEFORE UPDATE ON "AnalysisRunReview"
FOR EACH ROW EXECUTE FUNCTION "protect_analysis_input"();

CREATE FUNCTION "validate_analysis_input_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reviewId" IS NULL OR NEW."sourceReviewId" <> NEW."reviewId" OR NOT EXISTS (
    SELECT 1 FROM "Review" r JOIN "AnalysisRun" a ON a.id = NEW."runId"
    WHERE r.id = NEW."reviewId" AND r."productId" = a."productId"
      AND r."inputVersion" = NEW."inputVersion"
  ) THEN
    RAISE EXCEPTION 'Analysis input must reference a review of its product and input version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AnalysisRunReview_valid_source" BEFORE INSERT ON "AnalysisRunReview"
FOR EACH ROW EXECUTE FUNCTION "validate_analysis_input_source"();

COMMIT;

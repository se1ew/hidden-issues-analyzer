BEGIN;

-- Nullable fields keep historical results identifiable without inventing metadata.
ALTER TABLE "AspectMention" ADD COLUMN "originalName" TEXT;
ALTER TABLE "IssueMention" ADD COLUMN "masking" JSONB;

-- Retries copy the original failed snapshot, even if its source was edited or deleted.
-- Normal starts must still reference the current source version. A retry must copy
-- every immutable field from a failed input belonging to its explicit parent run.
CREATE OR REPLACE FUNCTION "validate_analysis_input_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AnalysisRun" child
    JOIN "AnalysisRun" parent ON parent.id = child."previousRunId"
      AND parent."productId" = child."productId" AND parent."userId" = child."userId"
    JOIN "AnalysisRunReview" input ON input."runId" = parent.id
    JOIN "ReviewAnalysis" result ON result."runReviewId" = input.id AND result."runId" = parent.id
    WHERE child.id = NEW."runId"
      AND child.scope->'retry'->>'kind' = 'failed_only'
      AND child.scope->'retry'->>'sourceRunId' = parent.id
      AND parent.status NOT IN ('queued', 'running')
      AND result.status = 'failed'
      AND (to_jsonb(input) - 'id' - 'runId') = (to_jsonb(NEW) - 'id' - 'runId')
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "AnalysisRun" a WHERE a.id = NEW."runId" AND a.scope ? 'retry') THEN
    RAISE EXCEPTION 'Retry input must copy an immutable failed parent input' USING ERRCODE = '23514';
  END IF;
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

COMMIT;

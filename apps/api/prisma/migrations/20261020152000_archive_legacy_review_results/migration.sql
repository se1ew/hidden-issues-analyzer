BEGIN;
CREATE TABLE "LegacyReviewResult" (
  "reviewId" TEXT PRIMARY KEY REFERENCES "Review"(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "LegacyReviewResult" ("reviewId", payload)
SELECT id, jsonb_build_object('cleanedText', "cleanedText", 'sentiment', sentiment,
  'sentimentScore', "sentimentScore", 'aspects', aspects, 'issues', issues,
  'hiddenIssueId', "hiddenIssueId", 'analyzedAt', "analyzedAt", 'legacyAnalysis', "legacyAnalysis")
FROM "Review" WHERE "cleanedText" IS NOT NULL OR sentiment IS NOT NULL OR aspects IS NOT NULL
  OR issues IS NOT NULL OR "hiddenIssueId" IS NOT NULL OR "analyzedAt" IS NOT NULL;
ALTER TABLE "Review" DROP COLUMN "cleanedText", DROP COLUMN sentiment, DROP COLUMN "sentimentScore",
  DROP COLUMN aspects, DROP COLUMN issues, DROP COLUMN "hiddenIssueId", DROP COLUMN "analyzedAt", DROP COLUMN "legacyAnalysis";

-- A derived view, not another stored copy of analysis. An edited input is pending again.
CREATE VIEW "CurrentReviewAnalysis" AS
SELECT DISTINCT ON (r.id) r.id AS "reviewId", a.id AS "analysisId", a.sentiment, a."sentimentScore",
  a."finishedAt" AS "analyzedAt", a."runId",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name', m.name, 'sentiment', m.sentiment) ORDER BY m.id)
    FROM "AspectMention" m WHERE m."analysisId" = a.id), '[]'::jsonb) AS aspects,
  COALESCE((SELECT jsonb_agg(m.defect ORDER BY m."quoteStart", m.id)
    FROM "IssueMention" m WHERE m."analysisId" = a.id), '[]'::jsonb) AS issues,
  COALESCE((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('groupLinks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'publicationId', c."publicationId", 'runId', c."runId", 'productId', c."productId"))
      FROM "IssueClusterMember" cm JOIN "IssueClusterSnapshot" c ON c.id = cm."clusterId"
      WHERE cm."issueMentionId" = m.id AND c."publicationId" = (
        SELECT g.id FROM "GroupingPublication" g WHERE g."runId" = a."runId" AND g."sealedAt" IS NOT NULL ORDER BY g."createdAt" DESC, g.id DESC LIMIT 1)
    ), '[]'::jsonb)) ORDER BY m."quoteStart", m.id)
    FROM "IssueMention" m WHERE m."analysisId" = a.id), '[]'::jsonb) AS evidence
FROM "Review" r JOIN "AnalysisRunReview" i ON i."reviewId" = r.id
  AND i."inputVersion" = r."inputVersion" AND i.text = r.text
  AND i.rating IS NOT DISTINCT FROM r.rating AND i."reviewDate" IS NOT DISTINCT FROM r."reviewDate"
JOIN "ReviewAnalysis" a ON a."runReviewId" = i.id AND a.status = 'succeeded'
JOIN "AnalysisRun" run ON run.id = a."runId" AND run.status IN ('completed', 'partial')
  AND (run.diagnostics->>'errorCode') IS NULL
  AND COALESCE(run.diagnostics->>'grouping', 'empty') IN ('completed', 'empty')
ORDER BY r.id, run."finishedAt" DESC NULLS LAST, run."createdAt" DESC, run.id DESC;
COMMIT;

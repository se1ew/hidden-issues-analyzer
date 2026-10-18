BEGIN;
ALTER TABLE "Product" ADD COLUMN "publishedGroupingId" TEXT;
ALTER TABLE "IssueClusterSnapshot" ADD COLUMN "publicationId" TEXT;
CREATE TABLE "GroupingPublication" (
  id TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "sourceId" TEXT, "actorUserId" TEXT, action JSONB, "sealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id,"runId"), UNIQUE (id,"productId"),
  FOREIGN KEY ("runId","productId") REFERENCES "AnalysisRun" (id,"productId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("productId") REFERENCES "Product" (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("actorUserId") REFERENCES "User" (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("sourceId","productId") REFERENCES "GroupingPublication" (id,"productId") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "GroupingPublication_productId_createdAt_idx" ON "GroupingPublication" ("productId","createdAt");
ALTER TABLE "Product" ADD CONSTRAINT "Product_publishedGroupingId_id_fkey"
FOREIGN KEY ("publishedGroupingId",id) REFERENCES "GroupingPublication" (id,"productId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "IssueClusterSnapshot" ADD CONSTRAINT "IssueClusterSnapshot_publicationId_runId_fkey"
FOREIGN KEY ("publicationId","runId") REFERENCES "GroupingPublication" (id,"runId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "EmbeddingCache" (
  id TEXT PRIMARY KEY, version TEXT NOT NULL, "textHash" TEXT NOT NULL, dimension INTEGER NOT NULL,
  vector JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (version,"textHash"), CHECK (dimension BETWEEN 1 AND 8192 AND jsonb_typeof(vector)='array' AND jsonb_array_length(vector)=dimension)
);
CREATE UNIQUE INDEX "IssueClusterSnapshot_one_problem_per_publication" ON "IssueClusterSnapshot" ("publicationId","problemId") WHERE "problemId" IS NOT NULL;
ALTER TABLE "IssueClusterSnapshot" ADD CONSTRAINT "IssueClusterSnapshot_independent_metrics"
CHECK ("publicationId" IS NULL OR (severity IS NULL AND visibility IS NULL AND "hiddenScore" IS NULL));

CREATE FUNCTION "protect_grouping_publication"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'Published groupings are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW)-'sealedAt') IS DISTINCT FROM (to_jsonb(OLD)-'sealedAt') THEN
    RAISE EXCEPTION 'Publication metadata is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "GroupingPublication_immutable" BEFORE UPDATE OR DELETE ON "GroupingPublication" FOR EACH ROW EXECUTE FUNCTION "protect_grouping_publication"();
CREATE FUNCTION "protect_grouping_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pub TEXT;
BEGIN
  IF TG_OP='INSERT' THEN pub=NEW."publicationId"; ELSE pub=OLD."publicationId"; END IF;
  IF EXISTS (SELECT 1 FROM "GroupingPublication" p WHERE p.id=pub AND p."sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Published snapshots are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM "GroupingPublication" p WHERE p.id=NEW."publicationId" AND p."sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot move a snapshot into a sealed publication' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "IssueClusterSnapshot_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "IssueClusterSnapshot" FOR EACH ROW EXECUTE FUNCTION "protect_grouping_snapshot"();
CREATE FUNCTION "protect_grouping_membership"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cluster TEXT;
BEGIN
  IF TG_OP='INSERT' THEN cluster=NEW."clusterId"; ELSE cluster=OLD."clusterId"; END IF;
  IF EXISTS (SELECT 1 FROM "IssueClusterSnapshot" s JOIN "GroupingPublication" p ON p.id=s."publicationId"
      WHERE s.id=cluster AND p."sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Published memberships are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM p.id FROM "GroupingPublication" p JOIN "IssueClusterSnapshot" s ON s."publicationId"=p.id WHERE s.id=NEW."clusterId" FOR UPDATE OF p;
    IF EXISTS (SELECT 1 FROM "IssueClusterSnapshot" s JOIN "GroupingPublication" p ON p.id=s."publicationId"
        WHERE s.id=NEW."clusterId" AND p."sealedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'Cannot add to a sealed publication' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "IssueClusterMember" m JOIN "IssueClusterSnapshot" a ON a.id=m."clusterId"
      JOIN "IssueClusterSnapshot" b ON b."publicationId"=a."publicationId"
      WHERE b.id=NEW."clusterId" AND a.id<>NEW."clusterId" AND m."issueMentionId"=NEW."issueMentionId") THEN
      RAISE EXCEPTION 'A mention belongs to one group per publication' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "IssueClusterMember_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "IssueClusterMember" FOR EACH ROW EXECUTE FUNCTION "protect_grouping_membership"();
CREATE FUNCTION "require_sealed_grouping"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publishedGroupingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "GroupingPublication" p WHERE p.id=NEW."publishedGroupingId" AND p."productId"=NEW.id AND p."sealedAt" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Only sealed groupings can be published' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "Product_sealed_grouping" BEFORE INSERT OR UPDATE OF "publishedGroupingId" ON "Product" FOR EACH ROW EXECUTE FUNCTION "require_sealed_grouping"();
CREATE FUNCTION "require_terminal_grouping"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publishedGroupingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "GroupingPublication" p JOIN "AnalysisRun" r ON r.id=p."runId"
      WHERE p.id=NEW."publishedGroupingId" AND p."sealedAt" IS NOT NULL AND r.status IN ('completed','partial') AND r.succeeded>0
  ) THEN RAISE EXCEPTION 'Only usable terminal runs can be published' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "Product_terminal_grouping" AFTER INSERT OR UPDATE OF "publishedGroupingId" ON "Product"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "require_terminal_grouping"();
COMMIT;

-- Explicit owner-checked product deletion is the sole exception to sealed-history
-- deletion protection. The setting is local to the deletion transaction and ID.
CREATE OR REPLACE FUNCTION "protect_grouping_publication"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('reviewlens.purge_product', true)=OLD."productId" THEN RETURN OLD; END IF;
  IF OLD."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'Published groupings are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF (to_jsonb(NEW)-'sealedAt') IS DISTINCT FROM (to_jsonb(OLD)-'sealedAt') THEN
    RAISE EXCEPTION 'Publication metadata is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION "protect_grouping_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pub TEXT;
BEGIN
  IF TG_OP='DELETE' AND current_setting('reviewlens.purge_product', true)=OLD."productId" THEN RETURN OLD; END IF;
  IF TG_OP='INSERT' THEN pub=NEW."publicationId"; ELSE pub=OLD."publicationId"; END IF;
  IF EXISTS (SELECT 1 FROM "GroupingPublication" p WHERE p.id=pub AND p."sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Published snapshots are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM "GroupingPublication" p WHERE p.id=NEW."publicationId" AND p."sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot move a snapshot into a sealed publication' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION "protect_grouping_membership"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cluster TEXT;
BEGIN
  IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM "IssueClusterSnapshot" s WHERE s.id=OLD."clusterId"
    AND s."productId"=current_setting('reviewlens.purge_product', true)) THEN RETURN OLD; END IF;
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

BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Product" WHERE "userId" IS NULL) THEN
    RAISE EXCEPTION 'Assign every legacy product explicitly with scripts/assign-legacy-product.mjs before applying the ownership migration';
  END IF;
END $$;
ALTER TABLE "Product" ALTER COLUMN "userId" SET NOT NULL;
COMMIT;

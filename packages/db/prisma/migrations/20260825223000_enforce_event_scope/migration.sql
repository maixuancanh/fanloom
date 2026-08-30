-- Enforce scope only after the durable backfill/repair migration is complete.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EngagementEvent" WHERE "tenantId" IS NULL OR "communityId" IS NULL OR "creatorId" IS NULL) THEN
    RAISE EXCEPTION 'Fanloom event scope remediation required before NOT NULL transition';
  END IF;
END $$;

ALTER TABLE "EngagementEvent"
  ALTER COLUMN "tenantId" SET NOT NULL,
  ALTER COLUMN "communityId" SET NOT NULL,
  ALTER COLUMN "creatorId" SET NOT NULL;

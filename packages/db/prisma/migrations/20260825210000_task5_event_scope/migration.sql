-- Stage scope columns and durable remediation evidence. This migration intentionally
-- never raises: a failed backfill must survive so an operator can repair each row.
ALTER TABLE "EngagementEvent"
  ADD COLUMN "tenantId" UUID,
  ADD COLUMN "communityId" UUID,
  ADD COLUMN "creatorId" UUID;

UPDATE "EngagementEvent" AS event
SET "tenantId" = fan."tenantId", "communityId" = fan."communityId", "creatorId" = fan."creatorId"
FROM "Fan" AS fan
WHERE event."fanId" = fan."id"
  AND (event."tenantId" IS NULL OR event."communityId" IS NULL OR event."creatorId" IS NULL);

CREATE TABLE IF NOT EXISTS "ProviderEventScopeRemediation" (
  "eventId" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "communityId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE "EngagementEvent" AS event
SET "tenantId" = remediation."tenantId", "communityId" = remediation."communityId", "creatorId" = remediation."creatorId"
FROM "ProviderEventScopeRemediation" AS remediation
WHERE event."id" = remediation."eventId"
  AND (event."tenantId" IS NULL OR event."communityId" IS NULL OR event."creatorId" IS NULL);

CREATE TABLE IF NOT EXISTS "EngagementEventScopeBackfillFailure" (
  "eventId" UUID PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "EngagementEventScopeBackfillFailure" ("eventId", "reason")
SELECT "id", CASE WHEN "fanId" IS NULL THEN 'missing_fan_authority' ELSE 'fan_scope_missing' END
FROM "EngagementEvent"
WHERE "tenantId" IS NULL OR "communityId" IS NULL OR "creatorId" IS NULL
ON CONFLICT ("eventId") DO NOTHING;

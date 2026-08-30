CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "EngagementEvent" ADD COLUMN "fingerprint" CHAR(64);

-- Canonical runtime format: each field is octet-length:value, joined by newlines.
UPDATE "EngagementEvent"
SET "fingerprint" = encode(digest(
  octet_length("tenantId"::text)::text || ':' || "tenantId"::text || E'\n' ||
  octet_length("communityId"::text)::text || ':' || "communityId"::text || E'\n' ||
  octet_length("provider")::text || ':' || "provider" || E'\n' ||
  octet_length("providerEventId")::text || ':' || "providerEventId" || E'\n' ||
  octet_length("creatorId"::text)::text || ':' || "creatorId"::text || E'\n' ||
  octet_length(coalesce("fanId"::text, ''))::text || ':' || coalesce("fanId"::text, '') || E'\n' ||
  octet_length("eventType")::text || ':' || "eventType" || E'\n' ||
  octet_length(to_char("occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text || ':' || to_char("occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || E'\n' ||
  octet_length("payload"::text)::text || ':' || "payload"::text,
  'sha256'), 'hex')
WHERE "fingerprint" IS NULL;

ALTER TABLE "EngagementEvent" ALTER COLUMN "fingerprint" SET NOT NULL;
DROP INDEX IF EXISTS "EngagementEvent_provider_providerEventId_key";
CREATE UNIQUE INDEX "EngagementEvent_tenantId_provider_providerEventId_key" ON "EngagementEvent"("tenantId", "provider", "providerEventId");

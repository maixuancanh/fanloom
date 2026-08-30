ALTER TABLE "Campaign"
  ADD COLUMN "budgetLimitMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "spentMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "CampaignAction"
  ADD COLUMN "maxSpendMinor" BIGINT,
  ADD COLUMN "evidenceEventIds" JSONB;

ALTER TABLE "Approval"
  ADD COLUMN "decisionHash" TEXT,
  ADD COLUMN "boundedSpendMinor" BIGINT,
  ADD COLUMN "decidedAt" TIMESTAMP(3);

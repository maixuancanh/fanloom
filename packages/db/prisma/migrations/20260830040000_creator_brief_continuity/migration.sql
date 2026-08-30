ALTER TABLE "Creator"
  ADD COLUMN "niche" TEXT,
  ADD COLUMN "audience" TEXT,
  ADD COLUMN "priorityChannels" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "goal30Day" TEXT,
  ADD COLUMN "differentiator" TEXT;

ALTER TABLE "MindAdvisorAudit"
  ADD COLUMN "conversationAlias" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "parentAuditId" UUID,
  ADD COLUMN "creatorProfileSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX "MindAdvisorAudit_creatorId_trigger_createdAt_idx"
  ON "MindAdvisorAudit"("creatorId", "trigger", "createdAt");

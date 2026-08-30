CREATE TABLE "MindAdvisorAudit" (
  "id" UUID NOT NULL,
  "outboxJobId" UUID NOT NULL,
  "creatorId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "communityId" UUID NOT NULL,
  "mindId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "transcriptRef" TEXT,
  "recommendation" JSONB,
  "validation" JSONB NOT NULL,
  "followUpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MindAdvisorAudit_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MindAdvisorAudit" ADD CONSTRAINT "MindAdvisorAudit_outboxJobId_fkey" FOREIGN KEY ("outboxJobId") REFERENCES "OutboxJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MindAdvisorAudit_outboxJobId_key" ON "MindAdvisorAudit"("outboxJobId");
CREATE UNIQUE INDEX "MindAdvisorAudit_requestId_key" ON "MindAdvisorAudit"("requestId");
CREATE INDEX "MindAdvisorAudit_creatorId_createdAt_idx" ON "MindAdvisorAudit"("creatorId", "createdAt");
CREATE INDEX "MindAdvisorAudit_tenantId_communityId_createdAt_idx" ON "MindAdvisorAudit"("tenantId", "communityId", "createdAt");

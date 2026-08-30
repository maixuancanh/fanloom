CREATE TABLE "MindEvaluationAudit" (
  "id" UUID NOT NULL,
  "outboxJobId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "communityId" UUID NOT NULL,
  "requestId" TEXT NOT NULL,
  "transcriptRef" TEXT,
  "decision" JSONB,
  "validation" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MindEvaluationAudit_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MindEvaluationAudit"
  ADD CONSTRAINT "MindEvaluationAudit_outboxJobId_fkey"
  FOREIGN KEY ("outboxJobId") REFERENCES "OutboxJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "MindEvaluationAudit_outboxJobId_key" ON "MindEvaluationAudit"("outboxJobId");
CREATE UNIQUE INDEX "MindEvaluationAudit_requestId_key" ON "MindEvaluationAudit"("requestId");
CREATE INDEX "MindEvaluationAudit_tenantId_communityId_createdAt_idx" ON "MindEvaluationAudit"("tenantId", "communityId", "createdAt");

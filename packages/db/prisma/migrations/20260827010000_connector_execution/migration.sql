CREATE TABLE "ConnectorExecution" (
  "id" UUID NOT NULL,
  "actionId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "connector" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerOperationId" TEXT,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConnectorExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConnectorExecution_actionId_key" ON "ConnectorExecution"("actionId");
CREATE UNIQUE INDEX "ConnectorExecution_idempotencyKey_key" ON "ConnectorExecution"("idempotencyKey");
ALTER TABLE "ConnectorExecution" ADD CONSTRAINT "ConnectorExecution_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CampaignAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

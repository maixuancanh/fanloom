ALTER TABLE "OutboxJob"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT;

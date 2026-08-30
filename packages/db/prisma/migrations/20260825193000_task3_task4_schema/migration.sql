-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('creator', 'fan', 'admin');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "TipStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "RewardEntryType" AS ENUM ('earn', 'spend', 'expire');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'processing', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "creatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "handle" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentGrant" (
    "id" UUID NOT NULL,
    "fanId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,

    CONSTRAINT "ConsentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementEvent" (
    "id" UUID NOT NULL,
    "fanId" UUID,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignAction" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'pending',
    "amountMinor" BIGINT,
    "currency" VARCHAR(10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignArtifact" (
    "id" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "campaignId" UUID,
    "objectKey" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mediaType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "reviewerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tip" (
    "id" UUID NOT NULL,
    "fanId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOperationId" TEXT,
    "status" "TipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLedger" (
    "id" UUID NOT NULL,
    "fanId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "entryType" "RewardEntryType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "communityId" UUID NOT NULL,
    "callerKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_userId_key" ON "Creator"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Fan_userId_key" ON "Fan"("userId");

-- CreateIndex
CREATE INDEX "ConsentGrant_tenantId_communityId_creatorId_idx" ON "ConsentGrant"("tenantId", "communityId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentGrant_tenantId_fanId_purpose_key" ON "ConsentGrant"("tenantId", "fanId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_idempotencyKey_key" ON "EngagementEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_provider_providerEventId_key" ON "EngagementEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignAction_idempotencyKey_key" ON "CampaignAction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignArtifact_objectKey_key" ON "CampaignArtifact"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tip_idempotencyKey_key" ON "Tip"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_idempotencyKey_key" ON "RewardLedger"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_tenantId_communityId_action_idempotencyKey_key" ON "AuditEvent"("tenantId", "communityId", "action", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxJob_tenantId_communityId_topic_idempotencyKey_key" ON "OutboxJob"("tenantId", "communityId", "topic", "idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_tenantId_communityId_callerKey_idx" ON "IdempotencyRecord"("tenantId", "communityId", "callerKey");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_tenantId_communityId_actorId_callerKey_op_key" ON "IdempotencyRecord"("tenantId", "communityId", "actorId", "callerKey", "operation", "resource");

-- AddForeignKey
ALTER TABLE "Creator" ADD CONSTRAINT "Creator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fan" ADD CONSTRAINT "Fan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentGrant" ADD CONSTRAINT "ConsentGrant_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "Fan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "Fan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignAction" ADD CONSTRAINT "CampaignAction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignArtifact" ADD CONSTRAINT "CampaignArtifact_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignArtifact" ADD CONSTRAINT "CampaignArtifact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CampaignAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "Fan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLedger" ADD CONSTRAINT "RewardLedger_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "Fan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

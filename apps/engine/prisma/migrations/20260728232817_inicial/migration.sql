-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "AppEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('DATING', 'SOCIAL', 'TELEMEDICINE', 'MARKETPLACE', 'OTHER');

-- CreateEnum
CREATE TYPE "AppHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNREACHABLE', 'NON_CONFORMANT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'ACTIVE', 'EXHAUSTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('EPISODIC', 'SEMANTIC');

-- CreateEnum
CREATE TYPE "SyntheticKind" AS ENUM ('USER', 'CONTENT', 'INTERACTION', 'MESSAGE');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('OK', 'REJECTED', 'ERROR', 'SKIPPED', 'DRY_RUN');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'OPERATOR',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_apps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "env" "AppEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "vertical" "Vertical" NOT NULL DEFAULT 'OTHER',
    "productionWritesAllowed" BOOLEAN NOT NULL DEFAULT false,
    "manifest" JSONB,
    "usiVersion" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "health" "AppHealth" NOT NULL DEFAULT 'UNKNOWN',
    "healthCheckedAt" TIMESTAMP(3),
    "healthDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usi_credentials" (
    "id" TEXT NOT NULL,
    "targetAppId" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "signingCipher" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usi_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "traits" JSONB NOT NULL,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locales" TEXT[] DEFAULT ARRAY['es-AR']::TEXT[],
    "goals" JSONB NOT NULL DEFAULT '[]',
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "actionMix" JSONB NOT NULL DEFAULT '{}',
    "intensity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "seed" JSONB NOT NULL DEFAULT '{}',
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetAppId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "agentCount" INTEGER NOT NULL DEFAULT 10,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "timeScale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "personaId" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'IDLE',
    "displayName" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es-AR',
    "traits" JSONB NOT NULL,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profile" JSONB NOT NULL DEFAULT '{}',
    "goals" JSONB NOT NULL DEFAULT '[]',
    "seed" TEXT NOT NULL,
    "externalUserId" TEXT,
    "lastActedAt" TIMESTAMP(3),
    "actionCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memories" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL DEFAULT 'EPISODIC',
    "content" TEXT NOT NULL,
    "subject" TEXT,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRecalled" TIMESTAMP(3),
    "recallCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_schedules" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "jobsTotal" INTEGER NOT NULL DEFAULT 0,
    "jobsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "jobsSkipped" INTEGER NOT NULL DEFAULT 0,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synthetic_entities" (
    "id" TEXT NOT NULL,
    "targetAppId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT,
    "kind" "SyntheticKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synthetic_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT,
    "actor" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "result" "AuditResult" NOT NULL DEFAULT 'OK',
    "targetAppId" TEXT,
    "agentId" TEXT,
    "entityId" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "members_tenantId_email_key" ON "members"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "target_apps_tenantId_idx" ON "target_apps"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "target_apps_tenantId_slug_key" ON "target_apps"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "usi_credentials_targetAppId_key" ON "usi_credentials"("targetAppId");

-- CreateIndex
CREATE INDEX "personas_tenantId_idx" ON "personas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "personas_tenantId_slug_key" ON "personas"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "scenarios_tenantId_idx" ON "scenarios"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_tenantId_slug_key" ON "scenarios"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_idx" ON "campaigns"("tenantId");

-- CreateIndex
CREATE INDEX "campaigns_targetAppId_idx" ON "campaigns"("targetAppId");

-- CreateIndex
CREATE INDEX "agents_campaignId_status_idx" ON "agents"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_campaignId_handle_key" ON "agents"("campaignId", "handle");

-- CreateIndex
CREATE INDEX "agent_memories_agentId_kind_idx" ON "agent_memories"("agentId", "kind");

-- CreateIndex
CREATE INDEX "agent_memories_agentId_occurredAt_idx" ON "agent_memories"("agentId", "occurredAt");

-- CreateIndex
CREATE INDEX "agent_schedules_agentId_idx" ON "agent_schedules"("agentId");

-- CreateIndex
CREATE INDEX "runs_campaignId_status_idx" ON "runs"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotencyKey_key" ON "jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_priority_idx" ON "jobs"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "jobs_runId_status_idx" ON "jobs"("runId", "status");

-- CreateIndex
CREATE INDEX "synthetic_entities_runId_kind_idx" ON "synthetic_entities"("runId", "kind");

-- CreateIndex
CREATE INDEX "synthetic_entities_targetAppId_purgedAt_idx" ON "synthetic_entities"("targetAppId", "purgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "synthetic_entities_targetAppId_kind_externalId_key" ON "synthetic_entities"("targetAppId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_at_idx" ON "audit_events"("tenantId", "at");

-- CreateIndex
CREATE INDEX "audit_events_runId_at_idx" ON "audit_events"("runId", "at");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_apps" ADD CONSTRAINT "target_apps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usi_credentials" ADD CONSTRAINT "usi_credentials_targetAppId_fkey" FOREIGN KEY ("targetAppId") REFERENCES "target_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_targetAppId_fkey" FOREIGN KEY ("targetAppId") REFERENCES "target_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synthetic_entities" ADD CONSTRAINT "synthetic_entities_targetAppId_fkey" FOREIGN KEY ("targetAppId") REFERENCES "target_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synthetic_entities" ADD CONSTRAINT "synthetic_entities_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

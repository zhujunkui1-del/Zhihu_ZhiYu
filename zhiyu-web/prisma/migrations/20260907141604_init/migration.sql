-- CreateEnum
CREATE TYPE "PersonaKind" AS ENUM ('human', 'public_creator', 'synthetic');

-- CreateEnum
CREATE TYPE "PersonaSourceType" AS ENUM ('wechat', 'qq', 'feishu', 'dingtalk', 'zhihu', 'sbti');

-- CreateEnum
CREATE TYPE "AgentSessionStatus" AS ENUM ('pending', 'running', 'analyzing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "zhihuOpenId" TEXT,
    "zhihuAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPrefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allowAgentInvite" BOOLEAN NOT NULL DEFAULT true,
    "showSimilarity" BOOLEAN NOT NULL DEFAULT true,
    "allowReportDelivery" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommunicationPrefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "PersonaKind" NOT NULL DEFAULT 'human',
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "publicRef" TEXT,
    "completeness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "identity" JSONB,
    "interests" JSONB,
    "topics" JSONB,
    "thinkingStyle" JSONB,
    "communicationStyle" JSONB,
    "values" JSONB,
    "socialStyle" JSONB,
    "personality" JSONB,
    "confidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaSource" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "type" "PersonaSourceType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_injected',
    "meta" JSONB,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "PersonaSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaEvidence" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trait" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "note" TEXT,
    "url" TEXT,

    CONSTRAINT "PersonaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaFeature" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "PersonaFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "personaAId" TEXT NOT NULL,
    "personaBId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'quick',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" "AgentSessionStatus" NOT NULL DEFAULT 'pending',
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "maxRounds" INTEGER NOT NULL DEFAULT 6,
    "initiatorUserId" TEXT,
    "meta" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchReport" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmProviderConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerKey" TEXT,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_zhihuOpenId_key" ON "User"("zhihuOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPrefs_userId_key" ON "CommunicationPrefs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_userId_key" ON "Persona"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaSource_personaId_type_key" ON "PersonaSource"("personaId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaFeature_personaId_key_key" ON "PersonaFeature"("personaId", "key");

-- CreateIndex
CREATE INDEX "Match_personaAId_idx" ON "Match"("personaAId");

-- CreateIndex
CREATE INDEX "Match_personaBId_idx" ON "Match"("personaBId");

-- CreateIndex
CREATE INDEX "AgentMessage_sessionId_round_idx" ON "AgentMessage"("sessionId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "MatchReport_matchId_key" ON "MatchReport"("matchId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmProviderConfig_userId_idx" ON "LlmProviderConfig"("userId");

-- AddForeignKey
ALTER TABLE "CommunicationPrefs" ADD CONSTRAINT "CommunicationPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaSource" ADD CONSTRAINT "PersonaSource_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaEvidence" ADD CONSTRAINT "PersonaEvidence_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaFeature" ADD CONSTRAINT "PersonaFeature_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_personaAId_fkey" FOREIGN KEY ("personaAId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_personaBId_fkey" FOREIGN KEY ("personaBId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmProviderConfig" ADD CONSTRAINT "LlmProviderConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

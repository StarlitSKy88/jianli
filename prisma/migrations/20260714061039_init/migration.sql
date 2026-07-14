-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'INTERVIEWER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "age" INTEGER,
    "city" TEXT,
    "currentRole" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifyCode" TEXT,
    "verifyExpiry" TIMESTAMP(3),
    "freeQuotaUsed" INTEGER NOT NULL DEFAULT 0,
    "paidQuota" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileUrl" TEXT,
    "fileHash" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsed" JSONB NOT NULL,
    "name" TEXT,
    "currentCompany" TEXT,
    "currentTitle" TEXT,
    "yearsOfExperience" INTEGER,
    "city" TEXT,
    "techStack" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "interviewerPrompt" TEXT NOT NULL,
    "scoringWeights" JSONB NOT NULL,
    "difficultyPrompt" TEXT NOT NULL,
    "estimatedDurationMin" INTEGER NOT NULL DEFAULT 20,
    "questionPoolSize" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "status" "InterviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "isFreeQuota" BOOLEAN NOT NULL DEFAULT true,
    "paymentId" TEXT,
    "totalScore" DOUBLE PRECISION,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "difficulty" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "improvements" JSONB NOT NULL,
    "cohortRank" TEXT,
    "cohortPercentile" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_scores" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "outTradeNo" TEXT NOT NULL,
    "transactionId" TEXT,
    "prepayId" TEXT,
    "productType" TEXT NOT NULL DEFAULT 'interview_quota',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventName" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "sessionId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_stories" (
    "id" TEXT NOT NULL,
    "storyKey" TEXT NOT NULL,
    "yamlPath" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "anonymized" BOOLEAN NOT NULL DEFAULT true,
    "summary" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "resumes_fileHash_key" ON "resumes"("fileHash");

-- CreateIndex
CREATE INDEX "resumes_userId_createdAt_idx" ON "resumes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "resumes_fileHash_idx" ON "resumes"("fileHash");

-- CreateIndex
CREATE INDEX "scenarios_company_isActive_idx" ON "scenarios"("company", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "scenarios_company_role_level_key" ON "scenarios"("company", "role", "level");

-- CreateIndex
CREATE INDEX "interviews_userId_startedAt_idx" ON "interviews"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "interviews_status_idx" ON "interviews"("status");

-- CreateIndex
CREATE INDEX "messages_interviewId_createdAt_idx" ON "messages"("interviewId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reports_interviewId_key" ON "reports"("interviewId");

-- CreateIndex
CREATE INDEX "agent_scores_reportId_idx" ON "agent_scores"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_outTradeNo_key" ON "payments"("outTradeNo");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "rate_limits_userId_resourceType_idx" ON "rate_limits"("userId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_userId_resourceType_windowStart_key" ON "rate_limits"("userId", "resourceType", "windowStart");

-- CreateIndex
CREATE INDEX "track_events_eventName_createdAt_idx" ON "track_events"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "track_events_userId_createdAt_idx" ON "track_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "case_stories_storyKey_key" ON "case_stories"("storyKey");

-- CreateIndex
CREATE INDEX "case_stories_company_role_level_idx" ON "case_stories"("company", "role", "level");

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resumes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_scores" ADD CONSTRAINT "agent_scores_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_events" ADD CONSTRAINT "track_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNING', 'UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanningStage" AS ENUM ('INTERVIEW', 'CONSTRAINTS', 'BASE', 'ROUTE', 'DAYS', 'BUDGET', 'VERIFICATION');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "BudgetCategory" AS ENUM ('LODGING', 'FOOD', 'TRANSPORT', 'ATTRACTIONS', 'CONTINGENCY');

-- CreateEnum
CREATE TYPE "PriceStatus" AS ENUM ('VERIFIED', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "CheckKind" AS ENUM ('FLIGHT', 'HOTEL', 'TICKET', 'SCHEDULE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNING',
    "notes" TEXT,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "destination" TEXT,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Traveler" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nonNegotiable" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Traveler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStage" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "stage" "PlanningStage" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "StageStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL DEFAULT '{}',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetItem" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PriceStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "sourceUrl" TEXT,
    "consultedAt" TIMESTAMP(3),
    "risk" TEXT,
    "mitigation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCheck" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "kind" "CheckKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Trip_ownerId_idx" ON "Trip"("ownerId");

-- CreateIndex
CREATE INDEX "Traveler_tripId_idx" ON "Traveler"("tripId");

-- CreateIndex
CREATE INDEX "TripStage_tripId_stage_idx" ON "TripStage"("tripId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "TripStage_tripId_stage_version_key" ON "TripStage"("tripId", "stage", "version");

-- CreateIndex
CREATE INDEX "BudgetItem_tripId_idx" ON "BudgetItem"("tripId");

-- CreateIndex
CREATE INDEX "VerificationCheck_tripId_idx" ON "VerificationCheck"("tripId");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Traveler" ADD CONSTRAINT "Traveler_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStage" ADD CONSTRAINT "TripStage_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetItem" ADD CONSTRAINT "BudgetItem_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCheck" ADD CONSTRAINT "VerificationCheck_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

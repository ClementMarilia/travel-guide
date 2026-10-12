-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GEMINI');

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "AiProvider" NOT NULL DEFAULT 'GEMINI',
    "model" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_userId_key" ON "AiSettings"("userId");

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

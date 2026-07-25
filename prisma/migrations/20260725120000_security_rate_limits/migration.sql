CREATE TABLE "SecurityRateLimitBucket" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityRateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "SecurityRateLimitBucket_resetAt_idx"
ON "SecurityRateLimitBucket"("resetAt");

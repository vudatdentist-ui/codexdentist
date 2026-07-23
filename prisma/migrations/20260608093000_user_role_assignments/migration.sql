-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL',
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- Backfill global management roles from the legacy single-role field.
INSERT INTO "UserRoleAssignment" (
    "id",
    "organizationId",
    "userId",
    "clinicId",
    "scopeKey",
    "role",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    'ura_' || md5("User"."id" || ':' || "User"."role"::text || ':GLOBAL'),
    "User"."organizationId",
    "User"."id",
    NULL,
    'GLOBAL',
    "User"."role",
    "User"."active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "User"."role" IN ('OWNER', 'AREA_MANAGER');

-- Backfill clinic-scoped operational roles from existing clinic memberships.
INSERT INTO "UserRoleAssignment" (
    "id",
    "organizationId",
    "userId",
    "clinicId",
    "scopeKey",
    "role",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    'ura_' || md5("User"."id" || ':' || "User"."role"::text || ':' || "UserClinic"."clinicId"),
    "User"."organizationId",
    "User"."id",
    "UserClinic"."clinicId",
    "UserClinic"."clinicId",
    "User"."role",
    "User"."active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
INNER JOIN "UserClinic" ON "UserClinic"."userId" = "User"."id"
WHERE "User"."role" NOT IN ('OWNER', 'AREA_MANAGER');

-- Preserve access for legacy users without clinic memberships.
INSERT INTO "UserRoleAssignment" (
    "id",
    "organizationId",
    "userId",
    "clinicId",
    "scopeKey",
    "role",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    'ura_' || md5("User"."id" || ':' || "User"."role"::text || ':GLOBAL'),
    "User"."organizationId",
    "User"."id",
    NULL,
    'GLOBAL',
    "User"."role",
    "User"."active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
WHERE "User"."role" NOT IN ('OWNER', 'AREA_MANAGER')
  AND NOT EXISTS (
      SELECT 1
      FROM "UserClinic"
      WHERE "UserClinic"."userId" = "User"."id"
  );

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_scopeKey_key" ON "UserRoleAssignment"("userId", "role", "scopeKey");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_organizationId_role_active_idx" ON "UserRoleAssignment"("organizationId", "role", "active");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_clinicId_role_active_idx" ON "UserRoleAssignment"("clinicId", "role", "active");

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

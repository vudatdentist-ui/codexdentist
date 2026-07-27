ALTER TABLE "Patient"
ADD COLUMN "portalUserId" TEXT;

WITH portal_candidates AS (
  SELECT
    u.id AS user_id,
    p.id AS patient_id,
    COUNT(*) OVER (PARTITION BY u.id) AS patient_count
  FROM "User" u
  JOIN "Patient" p
    ON p."organizationId" = u."organizationId"
   AND LOWER(p.email) = LOWER(u.email)
  WHERE p.email IS NOT NULL
    AND (
      u.role = 'PATIENT'
      OR EXISTS (
        SELECT 1
        FROM "UserRoleAssignment" ura
        WHERE ura."userId" = u.id
          AND ura.role = 'PATIENT'
          AND ura.active = TRUE
      )
    )
)
UPDATE "Patient" p
SET "portalUserId" = candidate.user_id
FROM portal_candidates candidate
WHERE candidate.patient_id = p.id
  AND candidate.patient_count = 1;

CREATE UNIQUE INDEX "Patient_portalUserId_key"
ON "Patient"("portalUserId");

ALTER TABLE "Patient"
ADD CONSTRAINT "Patient_portalUserId_fkey"
FOREIGN KEY ("portalUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

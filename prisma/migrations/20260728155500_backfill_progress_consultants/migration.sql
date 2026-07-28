UPDATE "TreatmentServiceProgressEvent" AS progress_event
SET "consultantId" = consultant_line."userId"
FROM (
  SELECT DISTINCT ON (accrual."progressEventId")
    accrual."progressEventId",
    line."userId"
  FROM "CompensationAccrual" AS accrual
  INNER JOIN "CompensationAccrualLine" AS line
    ON line."accrualId" = accrual."id"
  WHERE line."role" = 'CONSULTANT'
  ORDER BY accrual."progressEventId", line."createdAt", line."id"
) AS consultant_line
WHERE progress_event."id" = consultant_line."progressEventId"
  AND progress_event."consultantId" IS NULL;

UPDATE "TreatmentServiceProgressEvent" AS progress_event
SET "consultantId" = service."createdById"
FROM "TreatmentService" AS service
WHERE progress_event."treatmentServiceId" = service."id"
  AND progress_event."consultantId" IS NULL;

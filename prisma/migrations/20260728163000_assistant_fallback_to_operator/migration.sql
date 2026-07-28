UPDATE "ServiceCompensationShare"
SET
  "fallbackRole" = 'OPERATOR',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'ASSISTANT_PRIMARY'
  AND "fallbackRole" IS NULL;

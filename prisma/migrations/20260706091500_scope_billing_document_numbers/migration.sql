DROP INDEX IF EXISTS "Receipt_receiptNo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_organizationId_receiptNo_key"
  ON "Receipt"("organizationId", "receiptNo");

DROP INDEX IF EXISTS "PaymentPlan_planNo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentPlan_organizationId_planNo_key"
  ON "PaymentPlan"("organizationId", "planNo");

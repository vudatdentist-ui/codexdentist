-- AlterTable
ALTER TABLE "CompensationAccrual" ADD COLUMN     "ruleCode" TEXT,
ADD COLUMN     "ruleName" TEXT,
ADD COLUMN     "ruleSnapshot" JSONB,
ADD COLUMN     "ruleVersion" TEXT;

-- AlterTable
ALTER TABLE "ServiceCatalogItem" ADD COLUMN     "defaultCompensationRuleId" TEXT;

-- AlterTable
ALTER TABLE "ServiceCompensationRule" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "TreatmentService" ADD COLUMN     "compensationRuleCode" TEXT,
ADD COLUMN     "compensationRuleId" TEXT,
ADD COLUMN     "compensationRuleName" TEXT,
ADD COLUMN     "compensationRuleVersion" TEXT;

-- CreateIndex
CREATE INDEX "ServiceCatalogItem_defaultCompensationRuleId_idx" ON "ServiceCatalogItem"("defaultCompensationRuleId");

-- CreateIndex
CREATE INDEX "TreatmentService_compensationRuleId_idx" ON "TreatmentService"("compensationRuleId");

-- AddForeignKey
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_defaultCompensationRuleId_fkey" FOREIGN KEY ("defaultCompensationRuleId") REFERENCES "ServiceCompensationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentService" ADD CONSTRAINT "TreatmentService_compensationRuleId_fkey" FOREIGN KEY ("compensationRuleId") REFERENCES "ServiceCompensationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

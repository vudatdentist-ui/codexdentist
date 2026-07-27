ALTER TABLE "Invoice"
ADD CONSTRAINT "Invoice_amount_nonnegative_check"
CHECK (amount >= 0),
ADD CONSTRAINT "Invoice_paidAmount_range_check"
CHECK ("paidAmount" >= 0 AND "paidAmount" <= amount);

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_amount_nonzero_check"
CHECK (amount <> 0);

ALTER TABLE "InvoiceItem"
ADD CONSTRAINT "InvoiceItem_money_check"
CHECK (quantity > 0 AND "unitPrice" >= 0 AND amount >= 0);

ALTER TABLE "Receipt"
ADD CONSTRAINT "Receipt_amounts_check"
CHECK (
  amount > 0
  AND "allocatedAmount" >= 0
  AND "unallocatedAmount" >= 0
  AND "allocatedAmount" + "unallocatedAmount" = amount
);

ALTER TABLE "ReceiptAllocation"
ADD CONSTRAINT "ReceiptAllocation_amount_positive_check"
CHECK (amount > 0);

ALTER TABLE "PatientCreditBalance"
ADD CONSTRAINT "PatientCreditBalance_amount_nonnegative_check"
CHECK (amount >= 0);

CREATE FUNCTION "assert_billing_owner_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  clinic_organization_id TEXT;
  patient_organization_id TEXT;
  patient_clinic_id TEXT;
BEGIN
  SELECT "organizationId"
  INTO clinic_organization_id
  FROM "Clinic"
  WHERE id = NEW."clinicId";

  SELECT "organizationId", "clinicId"
  INTO patient_organization_id, patient_clinic_id
  FROM "Patient"
  WHERE id = NEW."patientId";

  IF clinic_organization_id IS DISTINCT FROM NEW."organizationId"
    OR patient_organization_id IS DISTINCT FROM NEW."organizationId"
    OR patient_clinic_id IS DISTINCT FROM NEW."clinicId"
  THEN
    RAISE EXCEPTION 'billing record organization, clinic, and patient scope must match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_owner_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "clinicId", "patientId"
ON "Invoice"
FOR EACH ROW EXECUTE PROCEDURE "assert_billing_owner_scope"();

CREATE TRIGGER "InvoiceItem_owner_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "clinicId", "patientId"
ON "InvoiceItem"
FOR EACH ROW EXECUTE PROCEDURE "assert_billing_owner_scope"();

CREATE TRIGGER "Receipt_owner_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "clinicId", "patientId"
ON "Receipt"
FOR EACH ROW EXECUTE PROCEDURE "assert_billing_owner_scope"();

CREATE TRIGGER "PatientCreditBalance_owner_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "clinicId", "patientId"
ON "PatientCreditBalance"
FOR EACH ROW EXECUTE PROCEDURE "assert_billing_owner_scope"();

CREATE FUNCTION "assert_invoice_item_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_organization_id TEXT;
  invoice_clinic_id TEXT;
  invoice_patient_id TEXT;
  service_organization_id TEXT;
  service_clinic_id TEXT;
  service_patient_id TEXT;
BEGIN
  SELECT "organizationId", "clinicId", "patientId"
  INTO invoice_organization_id, invoice_clinic_id, invoice_patient_id
  FROM "Invoice"
  WHERE id = NEW."invoiceId";

  IF invoice_organization_id IS DISTINCT FROM NEW."organizationId"
    OR invoice_clinic_id IS DISTINCT FROM NEW."clinicId"
    OR invoice_patient_id IS DISTINCT FROM NEW."patientId"
  THEN
    RAISE EXCEPTION 'invoice item scope must match its invoice'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."treatmentServiceId" IS NOT NULL THEN
    SELECT "organizationId", "clinicId", "patientId"
    INTO service_organization_id, service_clinic_id, service_patient_id
    FROM "TreatmentService"
    WHERE id = NEW."treatmentServiceId";

    IF service_organization_id IS DISTINCT FROM NEW."organizationId"
      OR service_clinic_id IS DISTINCT FROM NEW."clinicId"
      OR service_patient_id IS DISTINCT FROM NEW."patientId"
    THEN
      RAISE EXCEPTION 'invoice item scope must match its treatment service'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "InvoiceItem_relation_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "clinicId", "patientId", "invoiceId", "treatmentServiceId"
ON "InvoiceItem"
FOR EACH ROW EXECUTE PROCEDURE "assert_invoice_item_scope"();

CREATE FUNCTION "assert_receipt_allocation_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  related_organization_id TEXT;
  related_clinic_id TEXT;
  related_patient_id TEXT;
  related_invoice_id TEXT;
BEGIN
  SELECT "organizationId", "clinicId", "patientId"
  INTO related_organization_id, related_clinic_id, related_patient_id
  FROM "Receipt"
  WHERE id = NEW."receiptId";

  IF related_organization_id IS DISTINCT FROM NEW."organizationId"
    OR related_clinic_id IS DISTINCT FROM NEW."clinicId"
    OR related_patient_id IS DISTINCT FROM NEW."patientId"
  THEN
    RAISE EXCEPTION 'receipt allocation scope must match its receipt'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."invoiceId" IS NOT NULL THEN
    SELECT "organizationId", "clinicId", "patientId"
    INTO related_organization_id, related_clinic_id, related_patient_id
    FROM "Invoice"
    WHERE id = NEW."invoiceId";

    IF related_organization_id IS DISTINCT FROM NEW."organizationId"
      OR related_clinic_id IS DISTINCT FROM NEW."clinicId"
      OR related_patient_id IS DISTINCT FROM NEW."patientId"
    THEN
      RAISE EXCEPTION 'receipt allocation scope must match its invoice'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."invoiceItemId" IS NOT NULL THEN
    SELECT "organizationId", "clinicId", "patientId", "invoiceId"
    INTO related_organization_id, related_clinic_id, related_patient_id, related_invoice_id
    FROM "InvoiceItem"
    WHERE id = NEW."invoiceItemId";

    IF related_organization_id IS DISTINCT FROM NEW."organizationId"
      OR related_clinic_id IS DISTINCT FROM NEW."clinicId"
      OR related_patient_id IS DISTINCT FROM NEW."patientId"
      OR (
        NEW."invoiceId" IS NOT NULL
        AND related_invoice_id IS DISTINCT FROM NEW."invoiceId"
      )
    THEN
      RAISE EXCEPTION 'receipt allocation scope must match its invoice item'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."treatmentServiceId" IS NOT NULL THEN
    SELECT "organizationId", "clinicId", "patientId"
    INTO related_organization_id, related_clinic_id, related_patient_id
    FROM "TreatmentService"
    WHERE id = NEW."treatmentServiceId";

    IF related_organization_id IS DISTINCT FROM NEW."organizationId"
      OR related_clinic_id IS DISTINCT FROM NEW."clinicId"
      OR related_patient_id IS DISTINCT FROM NEW."patientId"
    THEN
      RAISE EXCEPTION 'receipt allocation scope must match its treatment service'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ReceiptAllocation_relation_scope_check"
BEFORE INSERT OR UPDATE OF
  "organizationId",
  "clinicId",
  "patientId",
  "receiptId",
  "invoiceId",
  "invoiceItemId",
  "treatmentServiceId"
ON "ReceiptAllocation"
FOR EACH ROW EXECUTE PROCEDURE "assert_receipt_allocation_scope"();

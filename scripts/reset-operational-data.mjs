import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);

  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const write = process.argv.includes("--write");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const wipedTables = [
  "PatientConsent",
  "Appointment",
  "ClinicalNote",
  "TreatmentPhase",
  "TreatmentPlan",
  "Payment",
  "InvoiceItem",
  "Invoice",
  "ReceiptAllocation",
  "Receipt",
  "PatientCreditBalance",
  "PaymentPlanInstallment",
  "PaymentPlan",
  "PostComment",
  "CommunityPost",
  "StaffProfile",
  "StaffShift",
  "AttendanceLog",
  "LeaveRequest",
  "PayrollLine",
  "PayrollRun",
  "CrmActivity",
  "CrmLead",
  "CrmCampaign",
  "CommunicationMessage",
  "CommunicationThread",
  "PurchaseOrderLine",
  "PurchaseOrder",
  "InventoryMovement",
  "InventoryLot",
  "InventoryItem",
  "InventorySupplier",
  "EquipmentAsset",
  "MaintenanceTask",
  "ServiceCompensationShare",
  "ServiceCompensationPoolRule",
  "ServiceCompensationRule",
  "ServiceMedication",
  "ServiceMaterial",
  "ServicePrice",
  "ServiceStep",
  "ServiceCatalogItem",
  "ServiceCategory",
  "TreatmentServiceProgressEvent",
  "TreatmentService",
  "CompensationAccrualLine",
  "CompensationAccrual",
  "PrescriptionItem",
  "Prescription",
  "PrescriptionTemplateItem",
  "PrescriptionTemplate",
  "MedicationCatalogItem",
  "PatientForm",
  "FormTemplate",
  "JourneyCommentAttachment",
  "JourneyComment",
  "PatientJourneyState",
  "PatientFile",
  "WorkItem",
  "LearningEnrollment",
  "LearningContent",
  "MobileDevice",
  "Notification",
  "AuditLog",
  "DocumentSequence",
  "Patient",
];

const preservedTables = [
  "Organization",
  "Clinic",
  "Chair",
  "User",
  "UserClinic",
  "Session",
  "PasswordResetToken",
];

async function tableCount(table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "${table}"`,
  );

  return rows[0]?.count ?? 0;
}

try {
  const before = Object.fromEntries(
    await Promise.all(
      [...preservedTables, ...wipedTables].map(async (table) => [
        table,
        await tableCount(table),
      ]),
    ),
  );

  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", before }, null, 2));

  if (!write) {
    process.exit(0);
  }

  const tableSql = wipedTables.map((table) => `"${table}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableSql} RESTART IDENTITY CASCADE`,
  );

  const after = Object.fromEntries(
    await Promise.all(
      [...preservedTables, ...wipedTables].map(async (table) => [
        table,
        await tableCount(table),
      ]),
    ),
  );

  console.log(JSON.stringify({ mode: "write", after }, null, 2));
} finally {
  await prisma.$disconnect();
}

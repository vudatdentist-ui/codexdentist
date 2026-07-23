import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const checks = [
  [
    "organization slug/domain mismatch",
    `
      SELECT id, slug, "primaryDomain"
      FROM "Organization"
      WHERE slug IS NOT NULL
        AND "primaryDomain" IS NOT NULL
        AND "primaryDomain" <> slug || '.${process.env.APP_ROOT_DOMAIN ?? "codexdentist.com"}'
      LIMIT 5
    `,
  ],
  [
    "patient clinic organization mismatch",
    `
      SELECT p.id
      FROM "Patient" p
      JOIN "Clinic" c ON c.id = p."clinicId"
      WHERE p."organizationId" <> c."organizationId"
      LIMIT 5
    `,
  ],
  [
    "appointment organization mismatch",
    `
      SELECT a.id
      FROM "Appointment" a
      JOIN "Clinic" c ON c.id = a."clinicId"
      JOIN "Patient" p ON p.id = a."patientId"
      JOIN "User" u ON u.id = a."providerId"
      WHERE p."organizationId" <> c."organizationId"
         OR u."organizationId" <> c."organizationId"
      LIMIT 5
    `,
  ],
  [
    "staff profile organization mismatch",
    `
      SELECT s.id
      FROM "StaffProfile" s
      JOIN "User" u ON u.id = s."userId"
      LEFT JOIN "Clinic" c ON c.id = s."clinicId"
      WHERE s."organizationId" <> u."organizationId"
         OR (c.id IS NOT NULL AND s."organizationId" <> c."organizationId")
      LIMIT 5
    `,
  ],
  [
    "treatment service organization mismatch",
    `
      SELECT ts.id
      FROM "TreatmentService" ts
      JOIN "Clinic" c ON c.id = ts."clinicId"
      JOIN "Patient" p ON p.id = ts."patientId"
      LEFT JOIN "ServiceCatalogItem" svc ON svc.id = ts."serviceCatalogItemId"
      WHERE ts."organizationId" <> c."organizationId"
         OR ts."organizationId" <> p."organizationId"
         OR (svc.id IS NOT NULL AND ts."organizationId" <> svc."organizationId")
      LIMIT 5
    `,
  ],
  [
    "progress event organization mismatch",
    `
      SELECT e.id
      FROM "TreatmentServiceProgressEvent" e
      JOIN "TreatmentService" ts ON ts.id = e."treatmentServiceId"
      JOIN "Clinic" c ON c.id = e."clinicId"
      JOIN "User" u ON u.id = e."performedById"
      WHERE e."organizationId" <> ts."organizationId"
         OR e."organizationId" <> c."organizationId"
         OR e."organizationId" <> u."organizationId"
      LIMIT 5
    `,
  ],
  [
    "receipt organization mismatch",
    `
      SELECT r.id
      FROM "Receipt" r
      JOIN "Clinic" c ON c.id = r."clinicId"
      JOIN "Patient" p ON p.id = r."patientId"
      WHERE r."organizationId" <> c."organizationId"
         OR r."organizationId" <> p."organizationId"
      LIMIT 5
    `,
  ],
  [
    "receipt allocation organization mismatch",
    `
      SELECT ra.id
      FROM "ReceiptAllocation" ra
      JOIN "Receipt" r ON r.id = ra."receiptId"
      JOIN "Patient" p ON p.id = ra."patientId"
      LEFT JOIN "TreatmentService" ts ON ts.id = ra."treatmentServiceId"
      WHERE ra."organizationId" <> r."organizationId"
         OR ra."organizationId" <> p."organizationId"
         OR (ts.id IS NOT NULL AND ra."organizationId" <> ts."organizationId")
      LIMIT 5
    `,
  ],
  [
    "invoice organization mismatch",
    `
      SELECT inv.id
      FROM "Invoice" inv
      JOIN "Clinic" c ON c.id = inv."clinicId"
      JOIN "Patient" p ON p.id = inv."patientId"
      WHERE inv."organizationId" <> c."organizationId"
         OR inv."organizationId" <> p."organizationId"
      LIMIT 5
    `,
  ],
  [
    "invoice number duplicate inside organization",
    `
      SELECT "organizationId", "invoiceNo"
      FROM "Invoice"
      GROUP BY "organizationId", "invoiceNo"
      HAVING COUNT(*) > 1
      LIMIT 5
    `,
  ],
  [
    "invoice item organization mismatch",
    `
      SELECT ii.id
      FROM "InvoiceItem" ii
      JOIN "Invoice" inv ON inv.id = ii."invoiceId"
      JOIN "Clinic" c ON c.id = ii."clinicId"
      JOIN "Patient" p ON p.id = ii."patientId"
      LEFT JOIN "TreatmentService" ts ON ts.id = ii."treatmentServiceId"
      WHERE ii."clinicId" <> inv."clinicId"
         OR ii."patientId" <> inv."patientId"
         OR ii."organizationId" <> c."organizationId"
         OR ii."organizationId" <> p."organizationId"
         OR (ts.id IS NOT NULL AND ii."organizationId" <> ts."organizationId")
      LIMIT 5
    `,
  ],
  [
    "patient file organization mismatch",
    `
      SELECT f.id
      FROM "PatientFile" f
      JOIN "Clinic" c ON c.id = f."clinicId"
      JOIN "Patient" p ON p.id = f."patientId"
      WHERE f."organizationId" <> c."organizationId"
         OR f."organizationId" <> p."organizationId"
      LIMIT 5
    `,
  ],
  [
    "patient form organization mismatch",
    `
      SELECT pf.id
      FROM "PatientForm" pf
      JOIN "Clinic" c ON c.id = pf."clinicId"
      JOIN "Patient" p ON p.id = pf."patientId"
      WHERE pf."organizationId" <> c."organizationId"
         OR pf."organizationId" <> p."organizationId"
      LIMIT 5
    `,
  ],
  [
    "prescription organization mismatch",
    `
      SELECT rx.id
      FROM "Prescription" rx
      JOIN "Clinic" c ON c.id = rx."clinicId"
      JOIN "Patient" p ON p.id = rx."patientId"
      WHERE rx."organizationId" <> c."organizationId"
         OR rx."organizationId" <> p."organizationId"
      LIMIT 5
    `,
  ],
  [
    "service child organization mismatch",
    `
      SELECT child_id
      FROM (
        SELECT st.id AS child_id, st."organizationId", svc."organizationId" AS parent_org
        FROM "ServiceStep" st
        JOIN "ServiceCatalogItem" svc ON svc.id = st."serviceId"
        UNION ALL
        SELECT sp.id AS child_id, sp."organizationId", svc."organizationId" AS parent_org
        FROM "ServicePrice" sp
        JOIN "ServiceCatalogItem" svc ON svc.id = sp."serviceId"
        UNION ALL
        SELECT sm.id AS child_id, sm."organizationId", svc."organizationId" AS parent_org
        FROM "ServiceMaterial" sm
        JOIN "ServiceCatalogItem" svc ON svc.id = sm."serviceId"
      ) x
      WHERE "organizationId" <> parent_org
      LIMIT 5
    `,
  ],
  [
    "inventory child organization mismatch",
    `
      SELECT child_id
      FROM (
        SELECT lot.id AS child_id, lot."organizationId", item."organizationId" AS parent_org
        FROM "InventoryLot" lot
        JOIN "InventoryItem" item ON item.id = lot."itemId"
        UNION ALL
        SELECT mov.id AS child_id, mov."organizationId", item."organizationId" AS parent_org
        FROM "InventoryMovement" mov
        JOIN "InventoryItem" item ON item.id = mov."itemId"
      ) x
      WHERE "organizationId" <> parent_org
      LIMIT 5
    `,
  ],
];

async function main() {
  for (const [label, sql] of checks) {
    await assertNoRows(label, sql);
  }

  console.log("ok data integrity smoke");
}

async function assertNoRows(label, sql) {
  const rows = await prisma.$queryRawUnsafe(sql);

  if (rows.length > 0) {
    throw new Error(`${label}: ${JSON.stringify(rows)}`);
  }

  console.log(`ok ${label}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

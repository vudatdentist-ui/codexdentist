import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function extractConstArray(source, constName) {
  const marker = `const ${constName} = [`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Cannot find ${constName}`);
  }

  const arrayStart = source.indexOf("[", start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(arrayStart, index + 1);
      }
    }
  }

  throw new Error(`Cannot parse ${constName}`);
}

function repairVietnameseText(value) {
  if (typeof value !== "string") return value;
  if (!/[\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]/.test(value)) return value;
  return Buffer.from(value, "latin1").toString("utf8");
}

function repairSeedRecord(value) {
  if (typeof value === "string") return repairVietnameseText(value);
  if (Array.isArray(value)) return value.map(repairSeedRecord);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairSeedRecord(item)]),
    );
  }
  return value;
}

function evaluateArray(arraySource) {
  return vm.runInNewContext(`(${arraySource})`, Object.create(null), {
    timeout: 1000,
  }).map(repairSeedRecord);
}

function displayMedicationName(medication) {
  const strength = medication.strength ? ` ${medication.strength}` : "";
  const genericName = medication.genericName.trim();
  const brandName = medication.brandName?.trim();
  const isCombination = /[+/]|clavulanic|clavulanate|phối hợp/i.test(genericName);

  if (brandName && isCombination) return `${brandName}${strength}`;
  if (brandName) return `${genericName}${strength} (${brandName})`;
  return `${genericName}${strength}`;
}

async function main() {
  const source = await readFile(resolve("src/lib/pharmacy.ts"), "utf8");
  const medications = evaluateArray(extractConstArray(source, "defaultMedications"));
  const templates = evaluateArray(extractConstArray(source, "defaultTemplates"));

  const organizations = await prisma.organization.findMany({
    include: {
      users: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const organization of organizations) {
    const actorId = organization.users[0]?.id ?? null;

    for (const medication of medications) {
      await prisma.medicationCatalogItem.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: medication.code,
          },
        },
        update: {
          genericName: medication.genericName,
          brandName: medication.brandName,
          strength: medication.strength,
          form: medication.form,
          defaultSig: medication.defaultSig,
          defaultDose: medication.defaultDose,
          route: medication.route,
          frequency: medication.frequency,
          warnings: medication.warnings,
          active: true,
        },
        create: {
          organizationId: organization.id,
          ...medication,
          active: true,
        },
      });
    }

    const medicationRows = await prisma.medicationCatalogItem.findMany({
      where: { organizationId: organization.id },
      select: {
        id: true,
        code: true,
        genericName: true,
        brandName: true,
        strength: true,
      },
    });
    const medicationByCode = new Map(
      medicationRows.map((medication) => [medication.code, medication]),
    );

    for (const template of templates) {
      const prescriptionTemplate = await prisma.prescriptionTemplate.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: template.code,
          },
        },
        update: {
          name: template.name,
          diagnosis: template.diagnosis,
          instructions: template.instructions,
          active: true,
        },
        create: {
          organizationId: organization.id,
          createdById: actorId,
          code: template.code,
          name: template.name,
          diagnosis: template.diagnosis,
          instructions: template.instructions,
          active: true,
        },
        select: { id: true },
      });

      await prisma.prescriptionTemplateItem.deleteMany({
        where: { templateId: prescriptionTemplate.id },
      });

      await prisma.prescriptionTemplateItem.createMany({
        data: template.items.map((item) => {
          const medication = medicationByCode.get(item.medicationCode);
          return {
            templateId: prescriptionTemplate.id,
            medicationId: medication?.id ?? null,
            drugName: medication ? displayMedicationName(medication) : item.medicationCode,
            sig: item.sig,
            quantity: item.quantity,
            refills: item.refills,
            durationDays: item.durationDays,
            instructions: item.instructions,
          };
        }),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        organizations: organizations.length,
        medications: medications.length,
        templates: templates.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

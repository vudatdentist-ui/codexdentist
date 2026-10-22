import "server-only";

import { prisma } from "@/lib/prisma";

/** Global identifiers retain their existing printable format and unique indexes. */
export async function nextGlobalDocumentNo(type: "FRM" | "RX", year = new Date().getFullYear()) {
  const where = { type_year: { type, year } };
  const prefix = `${type}-${year}-`;
  const existing = await prisma.globalDocumentSequence.findUnique({ where });
  let seed = 0;
  if (!existing) {
    const numbers = type === "FRM"
      ? (await prisma.patientForm.findMany({ where: { formNo: { startsWith: prefix } }, select: { formNo: true } })).map(row => row.formNo)
      : (await prisma.prescription.findMany({ where: { prescriptionNo: { startsWith: prefix } }, select: { prescriptionNo: true } })).map(row => row.prescriptionNo);
    for (const number of numbers) {
      const suffix = number.slice(prefix.length);
      if (/^\d+$/.test(suffix)) seed = Math.max(seed, Number(suffix));
    }
  }
  // Native upsert serializes allocation; simultaneous first callers increment
  // the row created by the winner instead of returning the same seed.
  const row = await prisma.globalDocumentSequence.upsert({
    where, create: { type, year, currentValue: seed + 1 },
    update: { currentValue: { increment: 1 } },
  });
  return prefix + String(row.currentValue).padStart(6, "0");
}

import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SequenceClient = Pick<PrismaClient, "documentSequence">;

export async function nextDocumentNo(input: {
  client?: SequenceClient;
  organizationId: string;
  clinicId?: string | null;
  type: "INV" | "RCT" | "PP" | "RX";
  prefix?: string;
  year?: number;
  pad?: number;
  seedCurrentValue?: () => Promise<number>;
}) {
  const client = input.client ?? prisma;
  const year = input.year ?? new Date().getFullYear();
  const prefix = input.prefix ?? input.type;
  const pad = input.pad ?? 6;
  const scopeKey = input.clinicId ? `clinic:${input.clinicId}` : "organization";
  const uniqueWhere = {
    organizationId_scopeKey_type_year: {
      organizationId: input.organizationId,
      scopeKey,
      type: input.type,
      year,
    },
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const seedCurrentValue = input.seedCurrentValue
        ? await input.seedCurrentValue()
        : 0;
      const minimumCurrentValue = seedCurrentValue + 1;
      const sequence = await client.documentSequence.upsert({
        where: uniqueWhere,
        create: {
          organizationId: input.organizationId,
          clinicId: input.clinicId ?? null,
          scopeKey,
          type: input.type,
          year,
          currentValue: minimumCurrentValue,
        },
        update: {
          currentValue: {
            increment: 1,
          },
        },
        select: {
          currentValue: true,
        },
      });

      const alignedSequence =
        sequence.currentValue < minimumCurrentValue
          ? await client.documentSequence.update({
              where: uniqueWhere,
              data: {
                currentValue: minimumCurrentValue,
              },
              select: {
                currentValue: true,
              },
            })
          : sequence;

      return `${prefix}-${year}-${String(alignedSequence.currentValue).padStart(pad, "0")}`;
    } catch (error) {
      if (!isUniqueConflict(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Unable to allocate document number.");
}

function isUniqueConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

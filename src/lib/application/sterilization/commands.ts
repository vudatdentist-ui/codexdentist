import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { assertSterilizationTransition } from "@/domains/operations/sterilization";

export {
  assertSterilizationTransition,
  sterilizationStatuses,
  type SterilizationStatus,
} from "@/domains/operations/sterilization";

export async function createSterilizationInstrumentCommand(session: AppSession, input: { code: string; name: string; category: string }) {
  requireAction(session, "sterilization.create", "sterilization-create-denied");
  const code = required(input.code, "sterilization-code-invalid");
  const name = required(input.name, "sterilization-name-invalid");
  const category = required(input.category, "sterilization-category-invalid");
  const clinicId = requireClinic(session);
  return prisma.$transaction(async (tx) => {
    const instrument = await tx.sterilizationInstrument.create({
      data: { id: randomUUID(), organizationId: session.organizationId, clinicId, code, name, category },
      select: instrumentSelect,
    });
    await audit(tx, session, "sterilization.instrument_created", "SterilizationInstrument", instrument.id, { code, clinicId: instrument.clinicId });
    return instrument;
  });
}

export async function createSterilizationCycleCommand(session: AppSession, input: { instrumentIds: string[]; method: string; machineName?: string | null; notes?: string | null }) {
  requireAction(session, "sterilization.create", "sterilization-create-denied");
  const clinicId = requireClinic(session);
  const instrumentIds = [...new Set(input.instrumentIds)].filter(Boolean).slice(0, 100);
  if (instrumentIds.length === 0) throw new ApplicationCommandError("sterilization-instruments-required");
  const method = required(input.method, "sterilization-method-invalid");
  const cycleNo = `STZ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const cycle = await prisma.$transaction(async (tx) => {
    for (const instrumentId of [...instrumentIds].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${session.organizationId}:${clinicId}:${instrumentId}`}))`;
    }
    const instruments = await tx.sterilizationInstrument.findMany({
      where: { id: { in: instrumentIds }, organizationId: session.organizationId, clinicId, status: "ACTIVE" },
      select: { id: true },
    });
    if (instruments.length !== instrumentIds.length) throw new ApplicationCommandError("sterilization-instrument-scope-invalid");
    const openCycleInstrument = await tx.sterilizationCycleInstrument.findFirst({
      where: {
        organizationId: session.organizationId,
        clinicId,
        instrumentId: { in: instrumentIds },
        cycle: { status: { in: ["PREPARING", "RUNNING", "PASSED"] } },
      },
      select: { instrumentId: true },
    });
    if (openCycleInstrument) throw new ApplicationCommandError("sterilization-instrument-busy");
    const created = await tx.sterilizationCycle.create({
      data: {
        id: randomUUID(), organizationId: session.organizationId, clinicId, cycleNo, method,
        machineName: clean(input.machineName, 160), notes: clean(input.notes, 4000), createdById: databaseActorId(session.userId),
        instruments: { create: instruments.map((instrument) => ({ instrumentId: instrument.id, organizationId: session.organizationId, clinicId })) },
      },
      select: cycleSelect,
    });
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: databaseActorId(session.userId), action: "sterilization.cycle_created", entityType: "SterilizationCycle", entityId: created.id, metadata: { cycleNo, clinicId, instrumentCount: instruments.length } as Prisma.InputJsonValue } });
    return created;
  });
  return cycle;
}

export async function listSterilizationCyclesCommand(session: AppSession) {
  requireAction(session, "sterilization.view", "sterilization-view-denied");
  return prisma.sterilizationCycle.findMany({ where: { organizationId: session.organizationId, clinicId: { in: allowedClinicIds(session) } }, orderBy: { createdAt: "desc" }, take: 200, select: cycleSelect });
}

export async function transitionSterilizationCycleCommand(session: AppSession, input: { id: string; status: string }) {
  requireAction(session, "sterilization.update", "sterilization-update-denied");
  return prisma.$transaction(async (tx) => {
    const cycle = await tx.sterilizationCycle.findFirst({ where: { id: input.id, organizationId: session.organizationId, clinicId: { in: allowedClinicIds(session) } }, select: { id: true, clinicId: true, cycleNo: true, status: true, instruments: { select: { instrumentId: true } } } });
    if (!cycle) throw new ApplicationCommandError("sterilization-cycle-not-found");
    assertSterilizationTransition(cycle.status, input.status);
    if (input.status === "RUNNING" && cycle.instruments.length === 0) throw new ApplicationCommandError("sterilization-instruments-required");
    const now = new Date();
    const result = await tx.sterilizationCycle.updateMany({
      where: { id: cycle.id, organizationId: session.organizationId, clinicId: cycle.clinicId, status: cycle.status },
      data: { status: input.status, ...(input.status === "RUNNING" ? { startedAt: now } : {}), ...(input.status === "PASSED" || input.status === "FAILED" ? { completedAt: now } : {}), ...(input.status === "RELEASED" ? { releasedAt: now } : {}) },
    });
    if (result.count !== 1) throw new ApplicationCommandError("sterilization-transition-conflict");
    const updated = await tx.sterilizationCycle.findUniqueOrThrow({ where: { id: cycle.id }, select: cycleSelect });
    if (input.status !== cycle.status) await audit(tx, session, "sterilization.cycle_status_changed", "SterilizationCycle", cycle.id, { cycleNo: cycle.cycleNo, clinicId: cycle.clinicId, from: cycle.status, to: input.status });
    return updated;
  });
}

const instrumentSelect = { id: true, clinicId: true, code: true, name: true, category: true, status: true, createdAt: true, updatedAt: true } as const;
const cycleSelect = { id: true, clinicId: true, cycleNo: true, status: true, method: true, machineName: true, startedAt: true, completedAt: true, releasedAt: true, notes: true, createdAt: true, updatedAt: true, instruments: { select: { instrumentId: true, instrument: { select: { code: true, name: true } } } } } as const;

function requireAction(session: AppSession, action: Parameters<typeof canPerformAction>[1], code: string) { if (!canPerformAction(session, action)) throw new ApplicationCommandError(code); }
function requireClinic(session: AppSession) { if (!session.activeClinicId || !session.clinicIds.includes(session.activeClinicId)) throw new ApplicationCommandError("sterilization-clinic-required"); return session.activeClinicId; }
function required(value: string, code: string) { const result = value.trim().slice(0, 200); if (!result) throw new ApplicationCommandError(code); return result; }
function clean(value: string | null | undefined, max: number) { const result = value?.trim(); return result ? result.slice(0, max) : null; }
async function audit(db: Prisma.TransactionClient, session: AppSession, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) { await db.auditLog.create({ data: { organizationId: session.organizationId, actorId: databaseActorId(session.userId), action, entityType, entityId, metadata: metadata as Prisma.InputJsonValue } }); }

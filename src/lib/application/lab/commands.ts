import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export const labStatuses = ["DRAFT", "SENT", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"] as const;
export type LabStatus = (typeof labStatuses)[number];

const transitions: Record<LabStatus, LabStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function assertLabTransition(from: string, to: string): asserts to is LabStatus {
  if (!labStatuses.includes(from as LabStatus) || !labStatuses.includes(to as LabStatus)) {
    throw new ApplicationCommandError("lab-status-invalid");
  }
  if (from !== to && !transitions[from as LabStatus].includes(to as LabStatus)) {
    throw new ApplicationCommandError("lab-status-transition-invalid");
  }
}

export async function createLabCaseCommand(session: AppSession, input: {
  patientId: string;
  treatmentServiceId?: string | null;
  title: string;
  workType: string;
  laboratoryName?: string | null;
  dueAt?: string | null;
  notes?: string | null;
}) {
  requireAction(session, "lab.case.create", "lab-case-create-denied");
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ApplicationCommandError("lab-patient-not-found");
  const title = normalizeRequired(input.title, "lab-title-invalid");
  const workType = normalizeRequired(input.workType, "lab-work-type-invalid");
  const dueAt = parseDueAt(input.dueAt);

  if (input.treatmentServiceId) {
    const service = await prisma.treatmentService.findFirst({
      where: {
        id: input.treatmentServiceId,
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
      },
      select: { id: true },
    });
    if (!service) throw new ApplicationCommandError("lab-treatment-service-not-found");
  }

  const caseNo = `LAB-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const labCase = await prisma.labCase.create({
    data: {
      id: randomUUID(),
      organizationId: session.organizationId,
      clinicId: patient.clinicId,
      patientId: patient.id,
      treatmentServiceId: input.treatmentServiceId || null,
      caseNo,
      title,
      workType,
      laboratoryName: cleanOptional(input.laboratoryName, 160),
      dueAt,
      notes: cleanOptional(input.notes, 4000),
      createdById: databaseActorId(session.userId),
    },
    select: labCaseSelect,
  });
  await audit(session, "lab.case_created", labCase.id, { caseNo, patientId: patient.id, clinicId: patient.clinicId });
  return labCase;
}

export async function listLabCasesCommand(session: AppSession, patientId?: string) {
  requireAction(session, "lab.case.view", "lab-case-view-denied");
  if (patientId) await assertPatientScope(session, patientId);
  return prisma.labCase.findMany({
    where: {
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
      ...(patientId ? { patientId } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    select: labCaseSelect,
  });
}

export async function transitionLabCaseCommand(session: AppSession, input: { id: string; status: string }) {
  requireAction(session, "lab.case.update", "lab-case-update-denied");
  const labCase = await prisma.labCase.findFirst({
    where: { id: input.id, organizationId: session.organizationId, clinicId: { in: session.clinicIds } },
    select: { id: true, status: true, caseNo: true, patientId: true, clinicId: true },
  });
  if (!labCase) throw new ApplicationCommandError("lab-case-not-found");
  assertLabTransition(labCase.status, input.status);
  const now = new Date();
  const updated = await prisma.labCase.update({
    where: { id: labCase.id },
    data: {
      status: input.status,
      ...(input.status === "SENT" ? { sentAt: now } : {}),
      ...(input.status === "READY" || input.status === "DELIVERED" ? { receivedAt: labCase.status === "READY" || labCase.status === "DELIVERED" ? undefined : now } : {}),
    },
    select: labCaseSelect,
  });
  if (input.status !== labCase.status) {
    await audit(session, "lab.case_status_changed", labCase.id, {
      caseNo: labCase.caseNo,
      patientId: labCase.patientId,
      clinicId: labCase.clinicId,
      from: labCase.status,
      to: input.status,
    });
  }
  return updated;
}

const labCaseSelect = {
  id: true,
  clinicId: true,
  patientId: true,
  treatmentServiceId: true,
  caseNo: true,
  title: true,
  laboratoryName: true,
  workType: true,
  status: true,
  dueAt: true,
  sentAt: true,
  receivedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { fullName: true } },
  clinic: { select: { name: true } },
} as const;

async function assertPatientScope(session: AppSession, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, organizationId: session.organizationId, clinicId: { in: session.clinicIds } },
    select: { id: true },
  });
  if (!patient) throw new ApplicationCommandError("lab-patient-not-found");
}

async function audit(session: AppSession, action: string, entityId: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action,
      entityType: "LabCase",
      entityId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

function requireAction(session: AppSession, action: Parameters<typeof canPerformAction>[1], code: string) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError(code);
}

function normalizeRequired(value: string, code: string) {
  const normalized = value.trim().slice(0, 200);
  if (!normalized) throw new ApplicationCommandError(code);
  return normalized;
}

function cleanOptional(value: string | null | undefined, max: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function parseDueAt(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApplicationCommandError("lab-due-date-invalid");
  return date;
}

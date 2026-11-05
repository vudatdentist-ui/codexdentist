import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ImagingDb = PrismaClient | Prisma.TransactionClient;

export type ImagingStudyInput = {
  organizationId: string;
  clinicId: string;
  patientId: string;
  connectionId: string;
  provider: string;
  externalStudyId: string;
  externalPatientId: string | null;
  studyInstanceUid: string;
  accessionNumber: string | null;
  modalities: string[];
  studyDate: Date | null;
  description: string | null;
  createdById: string | null;
};

export async function upsertImagingStudy(db: ImagingDb, input: ImagingStudyInput) {
  return db.imagingStudy.upsert({
    where: {
      organizationId_connectionId_externalStudyId: {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        externalStudyId: input.externalStudyId,
      },
    },
    update: {
      provider: input.provider,
      externalPatientId: input.externalPatientId,
      studyInstanceUid: input.studyInstanceUid,
      accessionNumber: input.accessionNumber,
      modalities: input.modalities,
      studyDate: input.studyDate,
      description: input.description,
      availability: "AVAILABLE",
      lastSyncedAt: new Date(),
      lastErrorCode: null,
      createdById: input.createdById,
    },
    create: {
      id: randomUUID(),
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      connectionId: input.connectionId,
      provider: input.provider,
      externalStudyId: input.externalStudyId,
      externalPatientId: input.externalPatientId,
      studyInstanceUid: input.studyInstanceUid,
      accessionNumber: input.accessionNumber,
      modalities: input.modalities,
      studyDate: input.studyDate,
      description: input.description,
      availability: "AVAILABLE",
      lastSyncedAt: new Date(),
      createdById: input.createdById,
    },
    select: imagingStudySelect,
  });
}

export async function createImagingStudy(db: ImagingDb, input: ImagingStudyInput) {
  return db.imagingStudy.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      connectionId: input.connectionId,
      provider: input.provider,
      externalStudyId: input.externalStudyId,
      externalPatientId: input.externalPatientId,
      studyInstanceUid: input.studyInstanceUid,
      accessionNumber: input.accessionNumber,
      modalities: input.modalities,
      studyDate: input.studyDate,
      description: input.description,
      availability: "AVAILABLE",
      lastSyncedAt: new Date(),
      createdById: input.createdById,
    },
    select: imagingStudySelect,
  });
}

export async function listImagingStudies(input: {
  organizationId: string;
  clinicIds: string[];
  patientId?: string;
}) {
  return prisma.imagingStudy.findMany({
    where: {
      organizationId: input.organizationId,
      clinicId: { in: input.clinicIds },
      ...(input.patientId ? { patientId: input.patientId } : {}),
    },
    orderBy: [{ studyDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: imagingStudySelect,
  });
}

export async function updateImagingStudyAvailability(
  db: ImagingDb,
  input: { id: string; availability: string; lastErrorCode?: string | null },
) {
  return db.imagingStudy.update({
    where: { id: input.id },
    data: {
      availability: input.availability,
      lastSyncedAt: new Date(),
      lastErrorCode: input.lastErrorCode ?? null,
    },
    select: imagingStudySelect,
  });
}

export async function getImagingStudyForScope(input: {
  id: string;
  organizationId: string;
  clinicIds: string[];
}) {
  return prisma.imagingStudy.findFirst({
    where: {
      id: input.id,
      organizationId: input.organizationId,
      clinicId: { in: input.clinicIds },
    },
    select: { ...imagingStudySelect, connectionId: true, provider: true },
  });
}

export const imagingStudySelect = {
  id: true,
  clinicId: true,
  patientId: true,
  connectionId: true,
  provider: true,
  externalStudyId: true,
  externalPatientId: true,
  studyInstanceUid: true,
  accessionNumber: true,
  modalities: true,
  studyDate: true,
  description: true,
  availability: true,
  lastSyncedAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { fullName: true } },
  clinic: { select: { name: true } },
} as const;

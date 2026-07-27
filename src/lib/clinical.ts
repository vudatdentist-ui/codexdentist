import "server-only";

import { patients as demoPatients, type Patient } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import { patientAccessWhere } from "@/lib/patient-access";
import type { AppRole } from "@/lib/permissions";
import type { ClinicalWorkspace } from "@/lib/clinical-types";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

const mutableClinicalRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
];

export async function getClinicalWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<ClinicalWorkspace> {
  try {
    const patientWhere = {
      ...patientAccessWhere(session),
      ...(options.patientId ? { id: options.patientId } : {}),
    };

    const [dbPatients, dbNotes] = await Promise.all([
      prisma.patient.findMany({
        where: patientWhere,
        include: {
          clinic: {
            select: {
              city: true,
            },
          },
          consents: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.clinicalNote.findMany({
        where: {
          ...(options.patientId ? { patientId: options.patientId } : {}),
          patient: patientWhere,
        },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
          author: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 12,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableClinicalRoles) && dbPatients.length > 0,
      message:
        dbPatients.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      patients: dbPatients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        age: patient.dateOfBirth ? ageFromDate(patient.dateOfBirth) : 0,
        phone: patient.phone,
        email: patient.email,
        city: patient.clinic.city,
        clinicId: patient.clinicId,
        dateOfBirth: patient.dateOfBirth ? vietnamDate(patient.dateOfBirth) : null,
        guardianName: patient.guardianName,
        address: patient.address,
        nationalId: patient.nationalId,
        nextVisit: "Clinical queue",
        lastVisit: "Open chart",
        balance: 0,
        consent: patient.consents[0]?.status === "GRANTED" ? "Granted" : "Needs renewal",
        consentVersion: patient.consents[0]?.version ?? null,
        consentSignedAt: patient.consents[0]?.signedAt
          ? vietnamDate(patient.consents[0].signedAt)
          : null,
        flags:
          patient.medicalAlerts.length > 0
            ? patient.medicalAlerts
            : ["No medical alerts recorded"],
        treatmentProgress: 0,
      })),
      notes: dbNotes.map((note) => ({
        id: note.id,
        patientId: note.patient.id,
        patient: note.patient.fullName,
        author: note.author.fullName,
        subjective: note.subjective,
        objective: note.objective,
        assessment: note.assessment,
        plan: note.plan,
        lockedAt: note.lockedAt ? vietnamDateTime(note.lockedAt) : null,
        createdAt: vietnamDateTime(note.createdAt),
        createdAtIso: note.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "clinical");
    return demoClinicalWorkspace(session);
  }
}

function demoClinicalWorkspace(session: AppSession): ClinicalWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const patients = demoPatients.filter((patient) => allowedIds.has(patient.clinicId));

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    patients,
    notes: patients.slice(0, 2).map((patient, index) => ({
      id: `demo-note-${patient.id}`,
      patientId: patient.id,
      patient: patient.name,
      author: index === 0 ? "Dr. Linh Tran" : "Dr. Thao Nguyen",
      subjective: "Patient reports mild soreness after previous visit.",
      objective: "Tissue response normal. No acute swelling.",
      assessment: "Continue current treatment plan.",
      plan: "Review imaging, confirm consent, and schedule follow-up.",
      lockedAt: null,
      createdAt: "Demo note",
      createdAtIso: null,
    })),
  };
}

function ageFromDate(date: Date) {
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

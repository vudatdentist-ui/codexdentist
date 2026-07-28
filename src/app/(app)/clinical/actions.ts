"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";

export async function createClinicalNoteAction(formData: FormData) {
  const session = await requireViewSession("clinical");

  if (
    !canPerformAction(session, "clinical.note.create") ||
    !canPerformAction(session, "clinical.note.sign")
  ) {
    redirect("/journey?notice=clinical-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const subjectiveRaw = requiredString(formData.get("subjective"));
  const subjective = subjectiveRaw || null;
  const objectiveInput = optionalString(formData.get("objective"));
  const medicalHistory = optionalString(formData.get("medicalHistory"));
  const temperature = optionalString(formData.get("temperature"));
  const bloodPressure = optionalString(formData.get("bloodPressure"));
  const heartRate = optionalString(formData.get("heartRate"));
  const vitals = [
    heartRate ? `Mạch: ${heartRate}` : null,
    temperature ? `Nhiệt độ: ${temperature}` : null,
    bloodPressure ? `Huyết áp: ${bloodPressure}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  const objective =
    [
      objectiveInput,
      medicalHistory ? `Bệnh sử: ${medicalHistory}` : null,
      vitals ? `Sinh hiệu: ${vitals}` : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null;
  const assessment = optionalString(formData.get("assessment"));
  const prognosis = optionalString(formData.get("prognosis"));
  const legacyPlan = optionalString(formData.get("plan"));
  const treatmentGoal = optionalString(formData.get("treatmentGoal"));
  const treatmentPlan = optionalString(formData.get("treatmentPlan"));
  const odontogramTeeth = splitList(formData.get("odontogramTeeth"), /[\n,]/);
  const hasTreatmentFields =
    formData.has("treatmentGoal") || formData.has("treatmentPlan");
  const canUpdateTreatmentPlan = canPerformAction(
    session,
    "treatment.plan.create",
  );

  if (hasTreatmentFields && !canUpdateTreatmentPlan) {
    redirect("/journey?notice=clinical-denied");
  }

  const plan =
    [
      legacyPlan,
      treatmentGoal ? `Mục tiêu điều trị: ${treatmentGoal}` : null,
      treatmentPlan ? `Kế hoạch điều trị: ${treatmentPlan}` : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null;

  if (
    !patientId ||
    (!subjective && !objective && !assessment && !prognosis && !plan)
  ) {
    redirect("/journey?notice=clinical-missing");
  }

  let notice: string | null = null;

  try {
    const [patient, author] = await Promise.all([
      prisma.patient.findFirst({
        where: {
          ...patientAccessWhere(session),
          id: patientId,
        },
        select: {
          id: true,
          clinicId: true,
        },
      }),
      prisma.user.findFirst({
        where: {
          id: session.userId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!patient || !author) {
      notice = "clinical-patient-not-found";
    } else {
      await prisma.$transaction(async (tx) => {
        const createdNote = await tx.clinicalNote.create({
          data: {
            patientId,
            authorId: author.id,
            subjective,
            objective,
            assessment,
            prognosis,
            plan,
            lockedAt: new Date(),
          },
          select: {
            id: true,
          },
        });

        if (subjective) {
          await tx.patient.update({
            where: {
              id: patientId,
            },
            data: {
              visitReason: subjective,
            },
          });
        }

        let journeyStateId: string | null = null;

        if (hasTreatmentFields && canUpdateTreatmentPlan) {
          const journeyState = await tx.patientJourneyState.upsert({
            where: {
              patientId,
            },
            update: {
              clinicId: patient.clinicId,
              treatmentGoal,
              treatmentPlan,
              odontogramTeeth,
              odontogramSnapshot: {
                selectedTargets: odontogramTeeth,
              } as Prisma.InputJsonValue,
              updatedById: author.id,
            },
            create: {
              organizationId: session.organizationId,
              clinicId: patient.clinicId,
              patientId,
              treatmentGoal,
              treatmentPlan,
              odontogramTeeth,
              odontogramSnapshot: {
                selectedTargets: odontogramTeeth,
              } as Prisma.InputJsonValue,
              updatedById: author.id,
            },
            select: {
              id: true,
            },
          });

          journeyStateId = journeyState.id;

          await tx.auditLog.create({
            data: {
              organizationId: session.organizationId,
              actorId: author.id,
              action: "journey.state_updated",
              entityType: "PatientJourneyState",
              entityId: journeyState.id,
              metadata: {
                patientId,
                odontogramTeeth,
                source: "clinical_timeline",
              } as Prisma.InputJsonValue,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: author.id,
            action: "clinical_note.created",
            entityType: "ClinicalNote",
            entityId: createdNote.id,
            metadata: {
              patientId,
              finalized: true,
              journeyStateId,
            },
          },
        });

        return createdNote;
      });
    }
  } catch (error) {
    console.error("clinical.note_create_failed", error);
    notice = "clinical-database";
  }

  if (notice) {
    redirect(`/journey?notice=${notice}`);
  }

  revalidatePath("/journey");
  revalidatePath("/clinical");
  revalidatePath("/patients");
  redirect(`/journey?notice=clinical-created&patientId=${encodeURIComponent(patientId)}`);
}

export async function lockClinicalNoteAction(formData: FormData) {
  const session = await requireViewSession("clinical");

  if (!canPerformAction(session, "clinical.note.sign")) {
    redirect("/journey?notice=clinical-denied");
  }

  const noteId = requiredString(formData.get("noteId"));

  if (!noteId) {
    redirect("/journey?notice=clinical-note-not-found");
  }

  let notice: string | null = null;
  let patientId: string | null = null;

  try {
    const note = await prisma.clinicalNote.findFirst({
      where: {
        id: noteId,
        patient: patientAccessWhere(session),
      },
      select: {
        id: true,
        lockedAt: true,
        patientId: true,
      },
    });

    if (!note) {
      notice = "clinical-note-not-found";
    } else {
      patientId = note.patientId;

      if (!note.lockedAt) {
        await prisma.clinicalNote.update({
          where: {
            id: noteId,
          },
          data: {
            lockedAt: new Date(),
          },
        });

        await writeClinicalAuditLog({
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "clinical_note.locked",
          entityId: noteId,
        });
      }
    }
  } catch {
    notice = "clinical-database";
  }

  if (notice) {
    redirect(`/journey?notice=${notice}`);
  }

  revalidatePath("/journey");
  redirect(
    `/journey?notice=clinical-locked${
      patientId ? `&patientId=${encodeURIComponent(patientId)}` : ""
    }`,
  );
}

async function writeClinicalAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: "ClinicalNote",
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

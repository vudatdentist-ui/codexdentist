import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export type FinalizeClinicalNoteInput = {
  patientId: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  prognosis: string | null;
  plan: string | null;
  treatmentGoal: string | null;
  treatmentPlan: string | null;
  odontogramTeeth: string[];
  updateTreatmentPlan: boolean;
};

export async function finalizeClinicalNoteCommand(
  session: AppSession,
  input: FinalizeClinicalNoteInput,
) {
  if (
    !canPerformAction(session, "clinical.note.create") ||
    !canPerformAction(session, "clinical.note.sign")
  ) {
    throw new ApplicationCommandError("clinical-denied");
  }
  if (input.updateTreatmentPlan && !canPerformAction(session, "treatment.plan.create")) {
    throw new ApplicationCommandError("clinical-denied");
  }

  const [patient, author] = await Promise.all([
    prisma.patient.findFirst({
      where: { ...patientAccessWhere(session), id: input.patientId },
      select: { id: true, clinicId: true },
    }),
    prisma.user.findFirst({
      where: { id: session.userId, organizationId: session.organizationId, active: true },
      select: { id: true },
    }),
  ]);

  if (!patient || !author) throw new ApplicationCommandError("clinical-patient-not-found");

  return prisma.$transaction(async (tx) => {
    const createdNote = await tx.clinicalNote.create({
      data: {
        patientId: input.patientId,
        authorId: author.id,
        subjective: input.subjective,
        objective: input.objective,
        assessment: input.assessment,
        prognosis: input.prognosis,
        plan: input.plan,
        lockedAt: new Date(),
      },
      select: { id: true },
    });

    if (input.subjective) {
      await tx.patient.update({
        where: { id: input.patientId },
        data: { visitReason: input.subjective },
      });
    }

    let journeyStateId: string | null = null;
    if (input.updateTreatmentPlan) {
      const journeyState = await tx.patientJourneyState.upsert({
        where: { patientId: input.patientId },
        update: {
          clinicId: patient.clinicId,
          treatmentGoal: input.treatmentGoal,
          treatmentPlan: input.treatmentPlan,
          odontogramTeeth: input.odontogramTeeth,
          odontogramSnapshot: { selectedTargets: input.odontogramTeeth } as Prisma.InputJsonValue,
          updatedById: author.id,
        },
        create: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: input.patientId,
          treatmentGoal: input.treatmentGoal,
          treatmentPlan: input.treatmentPlan,
          odontogramTeeth: input.odontogramTeeth,
          odontogramSnapshot: { selectedTargets: input.odontogramTeeth } as Prisma.InputJsonValue,
          updatedById: author.id,
        },
        select: { id: true },
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
            patientId: input.patientId,
            odontogramTeeth: input.odontogramTeeth,
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
          patientId: input.patientId,
          finalized: true,
          journeyStateId,
        } as Prisma.InputJsonValue,
      },
    });

    return createdNote;
  });
}

export async function lockClinicalNoteCommand(session: AppSession, noteId: string) {
  if (!canPerformAction(session, "clinical.note.sign")) {
    throw new ApplicationCommandError("clinical-denied");
  }

  const note = await prisma.clinicalNote.findFirst({
    where: { id: noteId, patient: patientAccessWhere(session) },
    select: { id: true, lockedAt: true, patientId: true },
  });
  if (!note) throw new ApplicationCommandError("clinical-note-not-found");
  if (note.lockedAt) return note;

  await prisma.$transaction(async (tx) => {
    await tx.clinicalNote.update({ where: { id: noteId }, data: { lockedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "clinical_note.locked",
        entityType: "ClinicalNote",
        entityId: noteId,
      },
    });
  });
  return note;
}

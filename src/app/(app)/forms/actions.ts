"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import { canMutateForms, nextPatientFormNo } from "@/lib/forms";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const formTypes = [
  "CONSENT",
  "INTAKE",
  "MEDICAL_HISTORY",
  "POST_OP",
  "FINANCIAL_POLICY",
  "CUSTOM",
] as const;

export async function createFormTemplateAction(formData: FormData) {
  const session = await requireViewSession("forms");

  if (!canMutateForms(session)) {
    redirect("/forms?notice=forms-denied");
  }

  const type = requiredString(formData.get("type"));
  const code = requiredString(formData.get("code")).toUpperCase();
  const name = requiredString(formData.get("name"));
  const version = requiredString(formData.get("version")) || "1.0";

  if (!isFormType(type) || !code || !name) {
    redirect("/forms?notice=forms-missing");
  }

  try {
    const template = await prisma.formTemplate.upsert({
      where: {
        organizationId_code_version: {
          organizationId: session.organizationId,
          code,
          version,
        },
      },
      update: {
        type,
        name,
        body: optionalString(formData.get("body")),
        requiresSignature: requiredString(formData.get("requiresSignature")) === "on",
        active: true,
        schema: {
          fields: [
            {
              id: "notes",
              label: "Responses",
              type: "textarea",
              required: true,
            },
          ],
        } as Prisma.InputJsonValue,
      },
      create: {
        organizationId: session.organizationId,
        createdById: databaseActorId(session.userId),
        type,
        code,
        name,
        version,
        body: optionalString(formData.get("body")),
        requiresSignature: requiredString(formData.get("requiresSignature")) === "on",
        active: true,
        schema: {
          fields: [
            {
              id: "notes",
              label: "Responses",
              type: "textarea",
              required: true,
            },
          ],
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
      },
    });

    await writeFormsAuditLog(session, "form_template.upserted", "FormTemplate", template.id, {
      code,
      version,
    });
  } catch {
    redirect("/forms?notice=forms-database");
  }

  revalidateFormsViews();
  redirect("/forms?notice=forms-template-saved");
}

export async function assignPatientFormAction(formData: FormData) {
  const session = await requireViewSession("forms");

  if (!canMutateForms(session)) {
    redirect("/forms?notice=forms-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const templateId = requiredString(formData.get("templateId"));
  const expiresAt = parseDateInVietnam(formData.get("expiresAt"));

  if (!patientId || !templateId || expiresAt === "invalid") {
    redirect("/forms?notice=forms-missing");
  }

  try {
    const [patient, template] = await Promise.all([
      prisma.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: allowedClinicIds(session),
          },
        },
        select: {
          id: true,
          clinicId: true,
        },
      }),
      prisma.formTemplate.findFirst({
        where: {
          id: templateId,
          organizationId: session.organizationId,
          active: true,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: allowedClinicIds(session),
              },
            },
          ],
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!patient || !template) {
      redirect("/forms?notice=forms-missing");
    }

    const formNo = await nextPatientFormNo(session.organizationId);
    const patientForm = await prisma.patientForm.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        templateId: template.id,
        requestedById: databaseActorId(session.userId),
        formNo,
        status: "SENT",
        sentAt: new Date(),
        expiresAt: expiresAt ?? null,
      },
      select: {
        id: true,
      },
    });

    await writeFormsAuditLog(session, "patient_form.sent", "PatientForm", patientForm.id, {
      formNo,
      patientId: patient.id,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/forms?notice=forms-database");
  }

  revalidateFormsViews();
  redirect("/forms?notice=forms-assigned");
}

export async function completePatientFormAction(formData: FormData) {
  const session = await requireViewSession("forms");

  if (!canMutateForms(session)) {
    redirect("/forms?notice=forms-denied");
  }

  const patientFormId = requiredString(formData.get("patientFormId"));
  const notes = requiredString(formData.get("responses"));
  const signatureUrl = optionalString(formData.get("signatureUrl"));

  if (!patientFormId || !notes) {
    redirect("/forms?notice=forms-missing");
  }

  try {
    const patientForm = await scopedPatientForm(session, patientFormId);

    if (!patientForm) {
      redirect("/forms?notice=forms-missing");
    }

    if (patientForm.status === "VOID" || patientForm.status === "COMPLETED") {
      redirect("/forms?notice=forms-not-open");
    }

    if (patientForm.template.requiresSignature && !signatureUrl) {
      redirect("/forms?notice=forms-signature-missing");
    }

    await prisma.patientForm.update({
      where: {
        id: patientForm.id,
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        responses: {
          notes,
          completedBy: session.fullName,
        } as Prisma.InputJsonValue,
        signatureUrl,
        attachments: splitList(formData.get("attachments")),
      },
    });

    await writeFormsAuditLog(session, "patient_form.completed", "PatientForm", patientForm.id, {
      formNo: patientForm.formNo,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/forms?notice=forms-database");
  }

  revalidateFormsViews();
  redirect("/forms?notice=forms-completed");
}

export async function voidPatientFormAction(formData: FormData) {
  const session = await requireViewSession("forms");

  if (!canMutateForms(session)) {
    redirect("/forms?notice=forms-denied");
  }

  const patientFormId = requiredString(formData.get("patientFormId"));
  const voidReason = requiredString(formData.get("voidReason"));

  if (!patientFormId || !voidReason) {
    redirect("/forms?notice=forms-void-reason-missing");
  }

  try {
    const patientForm = await scopedPatientForm(session, patientFormId);

    if (!patientForm) {
      redirect("/forms?notice=forms-missing");
    }

    if (patientForm.status === "VOID") {
      redirect("/forms?notice=forms-not-open");
    }

    await prisma.patientForm.update({
      where: {
        id: patientForm.id,
      },
      data: {
        status: "VOID",
      },
    });

    await writeFormsAuditLog(session, "patient_form.voided", "PatientForm", patientForm.id, {
      formNo: patientForm.formNo,
      reason: voidReason,
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/forms?notice=forms-database");
  }

  revalidateFormsViews();
  redirect("/forms?notice=forms-voided");
}

async function scopedPatientForm(session: AppSession, patientFormId: string) {
  if (!patientFormId) {
    return null;
  }

  return prisma.patientForm.findFirst({
    where: {
      id: patientFormId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: {
            in: allowedClinicIds(session),
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    select: {
      id: true,
      formNo: true,
      status: true,
      template: {
        select: {
          requiresSignature: true,
        },
      },
    },
  });
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

async function writeFormsAuditLog(
  session: AppSession,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action,
      entityType,
      entityId,
      metadata,
    },
  });
}

function isFormType(value: string): value is (typeof formTypes)[number] {
  return formTypes.includes(value as (typeof formTypes)[number]);
}

function revalidateFormsViews() {
  revalidatePath("/forms");
  revalidatePath("/journey");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import {
  canMutatePharmacy,
  displayMedicationName,
  nextPrescriptionNo,
} from "@/lib/pharmacy";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function createMedicationAction(formData: FormData) {
  const session = await requireViewSession("pharmacy");

  if (!canMutatePharmacy(session)) {
    redirect("/pharmacy?notice=pharmacy-denied");
  }

  const code = requiredString(formData.get("code")).toUpperCase();
  const genericName = requiredString(formData.get("genericName"));

  if (!code || !genericName) {
    redirect("/pharmacy?notice=pharmacy-missing");
  }

  try {
    await prisma.medicationCatalogItem.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code,
        },
      },
      update: {
        genericName,
        brandName: optionalString(formData.get("brandName")),
        strength: optionalString(formData.get("strength")),
        form: optionalString(formData.get("form")),
        defaultSig: optionalString(formData.get("defaultSig")),
        defaultDose: optionalString(formData.get("defaultDose")),
        route: optionalString(formData.get("route")),
        frequency: optionalString(formData.get("frequency")),
        warnings: splitList(formData.get("warnings")),
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        code,
        genericName,
        brandName: optionalString(formData.get("brandName")),
        strength: optionalString(formData.get("strength")),
        form: optionalString(formData.get("form")),
        defaultSig: optionalString(formData.get("defaultSig")),
        defaultDose: optionalString(formData.get("defaultDose")),
        route: optionalString(formData.get("route")),
        frequency: optionalString(formData.get("frequency")),
        warnings: splitList(formData.get("warnings")),
        active: true,
      },
    });

    await writePharmacyAuditLog(session, "medication.upserted", "MedicationCatalogItem", code);
  } catch {
    redirect("/pharmacy?notice=pharmacy-database");
  }

  revalidatePharmacyViews();
  redirect("/pharmacy?notice=pharmacy-medication-saved");
}

export async function createPrescriptionTemplateAction(formData: FormData) {
  const session = await requireViewSession("pharmacy");

  if (!canMutatePharmacy(session)) {
    redirect("/pharmacy?notice=pharmacy-denied");
  }

  const code = requiredString(formData.get("code")).toUpperCase();
  const name = requiredString(formData.get("name"));
  const items = await templateItemsFromForm(session, formData);

  if (!code || !name || items.length === 0) {
    redirect("/pharmacy?notice=pharmacy-missing");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const template = await tx.prescriptionTemplate.upsert({
        where: {
          organizationId_code: {
            organizationId: session.organizationId,
            code,
          },
        },
        update: {
          name,
          diagnosis: optionalString(formData.get("diagnosis")),
          instructions: optionalString(formData.get("instructions")),
          active: true,
        },
        create: {
          organizationId: session.organizationId,
          createdById: databaseActorId(session.userId),
          code,
          name,
          diagnosis: optionalString(formData.get("diagnosis")),
          instructions: optionalString(formData.get("instructions")),
          active: true,
        },
        select: {
          id: true,
        },
      });

      await tx.prescriptionTemplateItem.deleteMany({
        where: {
          templateId: template.id,
        },
      });
      await tx.prescriptionTemplateItem.createMany({
        data: items.map((item) => ({
          templateId: template.id,
          medicationId: item.medicationId,
          drugName: item.drugName,
          sig: item.sig,
          quantity: item.quantity,
          refills: item.refills,
          durationDays: item.durationDays,
          instructions: item.instructions,
        })),
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "prescription_template.upserted",
          entityType: "PrescriptionTemplate",
          entityId: template.id,
          metadata: {
            code,
          } as Prisma.InputJsonValue,
        },
      });
    });
  } catch {
    redirect("/pharmacy?notice=pharmacy-database");
  }

  revalidatePharmacyViews();
  redirect("/pharmacy?notice=pharmacy-template-saved");
}

export async function createPrescriptionAction(formData: FormData) {
  const session = await requireViewSession("pharmacy");

  if (!canMutatePharmacy(session)) {
    redirect("/pharmacy?notice=pharmacy-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const templateId = optionalString(formData.get("templateId"));
  const intent = optionalString(formData.get("intent"));

  if (!patientId) {
    redirect("/pharmacy?notice=pharmacy-patient-missing");
  }

  try {
    const patient = await prisma.patient.findFirst({
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
    });

    if (!patient) {
      redirect("/pharmacy?notice=pharmacy-patient-missing");
    }

    const template = templateId
      ? await prisma.prescriptionTemplate.findFirst({
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
          include: {
            items: {
              include: {
                medication: {
                  select: {
                    strength: true,
                  },
                },
              },
            },
          },
        })
      : null;

    const prescriptionItems = await manualPrescriptionItems(session, formData);

    if (prescriptionItems.length === 0) {
      redirect("/pharmacy?notice=pharmacy-item-missing");
    }

    ensureNoDuplicatePrescriptionItems(prescriptionItems);

    const prescriptionNo = await nextPrescriptionNo(session.organizationId);
    const shouldSignNow = intent === "sign";
    const signedAt = shouldSignNow ? new Date() : null;
    const prescription = await prisma.prescription.create({
      data: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        prescriberId: session.userId,
        prescriptionNo,
        status: shouldSignNow ? "SIGNED" : "DRAFT",
        diagnosis:
          optionalString(formData.get("diagnosis")) ?? template?.diagnosis ?? null,
        notes: optionalString(formData.get("notes")) ?? template?.instructions ?? null,
        signedAt,
        items: {
          create: prescriptionItems,
        },
      },
      select: {
        id: true,
      },
    });

    await writePharmacyAuditLog(
      session,
      "prescription.created",
      "Prescription",
      prescription.id,
      {
        prescriptionNo,
        patientId: patient.id,
      },
    );

    if (shouldSignNow) {
      await writePharmacyAuditLog(
        session,
        "prescription.signed",
        "Prescription",
        prescription.id,
        {
          prescriptionNo,
        },
      );
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/pharmacy?notice=pharmacy-database");
  }

  revalidatePharmacyViews();
  redirect(
    intent === "sign"
      ? "/pharmacy?notice=pharmacy-prescription-signed"
      : "/pharmacy?notice=pharmacy-prescription-created",
  );
}

export async function signPrescriptionAction(formData: FormData) {
  const session = await requireViewSession("pharmacy");

  if (!canMutatePharmacy(session)) {
    redirect("/pharmacy?notice=pharmacy-denied");
  }

  const prescriptionId = requiredString(formData.get("prescriptionId"));

  try {
    const prescription = await scopedPrescription(session, prescriptionId);

    if (!prescription) {
      redirect("/pharmacy?notice=pharmacy-prescription-missing");
    }

    if (prescription.status !== "DRAFT") {
      redirect("/pharmacy?notice=pharmacy-prescription-not-draft");
    }

    await prisma.prescription.update({
      where: {
        id: prescription.id,
      },
      data: {
        status: "SIGNED",
        signedAt: new Date(),
      },
    });

    await writePharmacyAuditLog(
      session,
      "prescription.signed",
      "Prescription",
      prescription.id,
      {
        prescriptionNo: prescription.prescriptionNo,
      },
    );
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/pharmacy?notice=pharmacy-database");
  }

  revalidatePharmacyViews();
  redirect("/pharmacy?notice=pharmacy-prescription-signed");
}

export async function markPrescriptionPrintedAction(formData: FormData) {
  const session = await requireViewSession("pharmacy");

  if (!canMutatePharmacy(session)) {
    redirect("/pharmacy?notice=pharmacy-denied");
  }

  const prescriptionId = requiredString(formData.get("prescriptionId"));

  try {
    const prescription = await scopedPrescription(session, prescriptionId);

    if (!prescription) {
      redirect("/pharmacy?notice=pharmacy-prescription-missing");
    }

    if (prescription.status !== "SIGNED") {
      redirect("/pharmacy?notice=pharmacy-prescription-unsigned");
    }

    await prisma.prescription.update({
      where: {
        id: prescription.id,
      },
      data: {
        printedAt: new Date(),
      },
    });

    await writePharmacyAuditLog(
      session,
      "prescription.printed",
      "Prescription",
      prescription.id,
      {
        prescriptionNo: prescription.prescriptionNo,
      },
    );
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/pharmacy?notice=pharmacy-database");
  }

  revalidatePharmacyViews();
  redirect("/pharmacy?notice=pharmacy-prescription-printed");
}

async function manualPrescriptionItems(session: AppSession, formData: FormData) {
  const medicationIds = formData.getAll("medicationId");
  const drugNames = formData.getAll("drugName");
  const strengths = formData.getAll("strength");
  const sigs = formData.getAll("sig");
  const doses = formData.getAll("dose");
  const routes = formData.getAll("route");
  const frequencies = formData.getAll("frequency");
  const quantities = formData.getAll("quantity");
  const refills = formData.getAll("refills");
  const durationDays = formData.getAll("durationDays");
  const instructions = formData.getAll("itemInstructions");
  const rowCount = Math.max(
    medicationIds.length,
    drugNames.length,
    sigs.length,
    doses.length,
    routes.length,
    frequencies.length,
  );
  const items = [];

  for (let index = 0; index < rowCount; index += 1) {
    const medicationId = optionalString(medicationIds[index] ?? null);
    const manualDrugName = optionalString(drugNames[index] ?? null);
    const manualSig = optionalString(sigs[index] ?? null);
    const dose = optionalString(doses[index] ?? null);
    const route = optionalString(routes[index] ?? null);
    const frequency = optionalString(frequencies[index] ?? null);
    const duration = parseInteger(durationDays[index] ?? null);
    const itemInstructions = optionalString(instructions[index] ?? null);

    const hasAnyInput = Boolean(
      medicationId ||
        manualDrugName ||
        manualSig ||
        dose ||
        route ||
        frequency ||
        optionalString(quantities[index] ?? null) ||
        itemInstructions,
    );

    if (!hasAnyInput) {
      continue;
    }

    const medication = medicationId
      ? await prisma.medicationCatalogItem.findFirst({
          where: {
            id: medicationId,
            organizationId: session.organizationId,
            active: true,
          },
          select: {
            id: true,
            genericName: true,
            brandName: true,
            strength: true,
            defaultSig: true,
          },
        })
      : null;

    const drugName =
      manualDrugName ??
      (medication
        ? displayMedicationName({
            genericName: medication.genericName,
            brandName: medication.brandName,
            strength: medication.strength,
          })
        : "");
    const sig =
      manualSig ??
      composePrescriptionSig({
        dose,
        route,
        frequency,
        durationDays: duration,
      }) ??
      medication?.defaultSig ??
      "";

    if (!drugName || !sig) {
      redirect("/pharmacy?notice=pharmacy-item-invalid");
    }

    items.push({
      medicationId,
      drugName,
      strength: medication?.strength ?? optionalString(strengths[index] ?? null),
      sig,
      quantity: optionalString(quantities[index] ?? null),
      refills: parseInteger(refills[index] ?? null) ?? 0,
      durationDays: duration,
      instructions: itemInstructions,
    });
  }

  return items;
}

async function templateItemsFromForm(session: AppSession, formData: FormData) {
  const medicationIds = formData.getAll("medicationId");
  const drugNames = formData.getAll("drugName");
  const sigs = formData.getAll("sig");
  const quantities = formData.getAll("quantity");
  const refills = formData.getAll("refills");
  const durationDays = formData.getAll("durationDays");
  const rowCount = Math.max(medicationIds.length, drugNames.length, sigs.length);
  const items = [];

  for (let index = 0; index < rowCount; index += 1) {
    let medicationId = optionalString(medicationIds[index] ?? null);
    const manualDrugName = optionalString(drugNames[index] ?? null);
    const sig = requiredString(sigs[index] ?? null);

    if (!sig) {
      continue;
    }

    let medication = medicationId
      ? await prisma.medicationCatalogItem.findFirst({
          where: {
            id: medicationId,
            organizationId: session.organizationId,
            active: true,
          },
          select: {
            id: true,
            genericName: true,
            brandName: true,
            strength: true,
          },
        })
      : null;

    if (!medication && manualDrugName) {
      const medicationCandidates = await prisma.medicationCatalogItem.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
          genericName: true,
          brandName: true,
          strength: true,
        },
      });
      medication =
        medicationCandidates.find(
          (candidate) =>
            displayMedicationName({
              genericName: candidate.genericName,
              brandName: candidate.brandName,
              strength: candidate.strength,
            }) === manualDrugName,
        ) ?? null;
      medicationId = medication?.id ?? null;
    }

    const drugName =
      manualDrugName ??
      (medication
        ? displayMedicationName({
            genericName: medication.genericName,
            brandName: medication.brandName,
            strength: medication.strength,
          })
        : "");

    if (!drugName) {
      continue;
    }

    items.push({
      medicationId,
      drugName,
      sig,
      quantity: optionalString(quantities[index] ?? null),
      refills: parseInteger(refills[index] ?? null) ?? 0,
      durationDays: parseInteger(durationDays[index] ?? null),
      instructions: null,
    });
  }

  return items;
}

async function scopedPrescription(session: AppSession, prescriptionId: string) {
  if (!prescriptionId) {
    return null;
  }

  return prisma.prescription.findFirst({
    where: {
      id: prescriptionId,
      organizationId: session.organizationId,
      clinicId: {
        in: allowedClinicIds(session),
      },
    },
    select: {
      id: true,
      prescriptionNo: true,
      status: true,
    },
  });
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

async function writePharmacyAuditLog(
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

function parseInteger(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mergePrescriptionDirections(sig: string, instructions: string | null) {
  const cleanSig = sig.trim();
  const cleanInstructions = instructions?.trim() ?? "";

  if (!cleanInstructions || cleanSig === cleanInstructions) {
    return cleanSig;
  }

  return `${cleanSig}\n${cleanInstructions}`;
}

function composePrescriptionSig({
  dose,
  route,
  frequency,
  durationDays,
}: {
  dose: string | null;
  route: string | null;
  frequency: string | null;
  durationDays: number | null;
}) {
  const parts = [route, dose, frequency].filter(Boolean).join(" - ");

  if (!parts && !durationDays) {
    return null;
  }

  if (durationDays && parts) {
    return `${parts}. Dùng trong ${durationDays} ngày.`;
  }

  return durationDays ? `Dùng trong ${durationDays} ngày.` : parts;
}

function ensureNoDuplicatePrescriptionItems(
  items: Array<{
    medicationId: string | null;
    drugName: string;
    sig: string;
  }>,
) {
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${item.medicationId ?? item.drugName}`.trim().toLowerCase();

    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      redirect("/pharmacy?notice=pharmacy-item-duplicate");
    }

    seen.add(key);
  }
}

function revalidatePharmacyViews() {
  revalidatePath("/pharmacy");
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

import "server-only";

import { Buffer } from "node:buffer";
import type { Prisma } from "@prisma/client";
import { defaultDataSeedEnabled } from "@/lib/env";
import { canUseAllClinics, hasAnyRole, type AppRole, type RoleSource } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type {
  FormsWorkspace,
  FormTemplateSummary,
  PatientFormSummary,
  PrintableFormTemplate,
} from "@/lib/forms-types";
import type { AppSession } from "@/lib/session";

const mutableFormsRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

const defaultFormTemplates = [
  {
    type: "CONSENT" as const,
    code: "CONSENT-TX",
    name: "Đồng ý điều trị",
    version: "1.0",
    body:
      "Bệnh nhân xác nhận đã hiểu chẩn đoán, điều trị đề xuất, lựa chọn thay thế, rủi ro, chi phí và trách nhiệm tái khám/chăm sóc sau điều trị.",
    requiresSignature: true,
  },
  {
    type: "MEDICAL_HISTORY" as const,
    code: "MED-HX",
    name: "Cập nhật tiền sử y khoa",
    version: "1.0",
    body:
      "Bệnh nhân cập nhật dị ứng, thuốc đang dùng, bệnh toàn thân, tình trạng thai kỳ và tiền sử nha khoa liên quan.",
    requiresSignature: true,
  },
  {
    type: "FINANCIAL_POLICY" as const,
    code: "FIN-POL",
    name: "Xác nhận chính sách tài chính",
    version: "1.0",
    body:
      "Bệnh nhân xác nhận đã hiểu báo giá, tiền cọc, thanh toán từng phần, số dư còn lại, xử lý hoàn tiền và quy định xuất hóa đơn.",
    requiresSignature: true,
  },
];

const canonicalFormTemplates = [
  {
    type: "CONSENT" as const,
    code: "CONSENT-TX",
    name: "Đồng ý điều trị",
    version: "1.0",
    body:
      "Bệnh nhân xác nhận đã hiểu chẩn đoán, điều trị đề xuất, lựa chọn thay thế, rủi ro, chi phí và trách nhiệm tái khám/chăm sóc sau điều trị.",
    requiresSignature: true,
  },
  {
    type: "MEDICAL_HISTORY" as const,
    code: "MED-HX",
    name: "Cập nhật tiền sử y khoa",
    version: "1.0",
    body:
      "Bệnh nhân cập nhật dị ứng, thuốc đang dùng, bệnh toàn thân, tình trạng thai kỳ và tiền sử nha khoa liên quan.",
    requiresSignature: true,
  },
  {
    type: "FINANCIAL_POLICY" as const,
    code: "FIN-POL",
    name: "Xác nhận chính sách tài chính",
    version: "1.0",
    body:
      "Bệnh nhân xác nhận đã hiểu báo giá, tiền cọc, thanh toán từng phần, số dư còn lại, xử lý hoàn tiền và quy định xuất hóa đơn.",
    requiresSignature: true,
  },
];

export async function getFormsWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<FormsWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    if (defaultDataSeedEnabled()) {
      await ensureFormsSeed(session);
    }

    const [patients, templates, patientForms] = await Promise.all([
      prisma.patient.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { id: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          clinicId: true,
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.formTemplate.findMany({
        where: {
          organizationId: session.organizationId,
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
        },
        orderBy: [
          {
            type: "asc",
          },
          {
            code: "asc",
          },
        ],
      }),
      prisma.patientForm.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          OR: [
            {
              clinicId: {
                in: clinicIds,
              },
            },
            {
              clinicId: null,
            },
          ],
        },
        include: {
          patient: {
            select: {
              fullName: true,
            },
          },
          template: {
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              version: true,
              body: true,
              requiresSignature: true,
            },
          },
          requestedBy: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 120,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableFormsRoles),
      message: null,
      patients: patients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        phone: patient.phone,
        clinicId: patient.clinicId,
      })),
      templates: templates.map(toFormTemplateSummary),
      patientForms: patientForms.map(toPatientFormSummary),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "forms");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      patients: [],
      templates: [],
      patientForms: [],
    };
  }
}

export async function nextPatientFormNo(organizationId: string) {
  const count = await prisma.patientForm.count({
    where: {
      organizationId,
    },
  });

  return `FRM-${new Date().getFullYear()}-${String(count + 1).padStart(6, "0")}`;
}

export function canMutateForms(source: RoleSource) {
  return hasAnyRole(source, mutableFormsRoles);
}

export async function getPrintableFormTemplate(
  session: AppSession,
  templateId: string,
  patientId?: string | null,
): Promise<PrintableFormTemplate | null> {
  const clinicIds = allowedClinicIds(session);
  const template = await prisma.formTemplate.findFirst({
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
            in: clinicIds,
          },
        },
      ],
    },
    include: {
      organization: {
        select: {
          name: true,
        },
      },
      clinic: {
        select: {
          name: true,
          city: true,
        },
      },
    },
  });

  if (!template) {
    return null;
  }

  const patient = patientId
    ? await prisma.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          fullName: true,
          dateOfBirth: true,
          phone: true,
          address: true,
          visitReason: true,
          clinic: {
            select: {
              name: true,
              city: true,
            },
          },
        },
      })
    : null;
  const defaultClinic = patient?.clinic ?? template.clinic ?? (await fallbackClinic(session));

  return {
    templateCode: template.code,
    templateName: template.name,
    templateType: template.type,
    templateVersion: template.version,
    organizationName: template.organization.name,
    clinicName: defaultClinic?.name ?? "",
    clinicCity: defaultClinic?.city ?? "",
    patientName: patient?.fullName ?? "",
    patientAge: patient?.dateOfBirth ? String(ageFromDate(patient.dateOfBirth)) : "",
    patientPhone: patient?.phone ?? "",
    patientAddress: patient?.address ?? "",
    visitReason: patient?.visitReason ?? "",
    body: template.body ?? "",
    requiresSignature: template.requiresSignature,
    printedAt: vietnamDateTime(new Date()),
  };
}

export async function ensureFormsSeed(session: AppSession) {
  void defaultFormTemplates;

  for (const template of canonicalFormTemplates) {
    await prisma.formTemplate.upsert({
      where: {
        organizationId_code_version: {
          organizationId: session.organizationId,
          code: template.code,
          version: template.version,
        },
      },
      update: {
        type: template.type,
        name: template.name,
        body: template.body,
        requiresSignature: template.requiresSignature,
        active: true,
      },
      create: {
        organizationId: session.organizationId,
        createdById: databaseUserId(session.userId),
        type: template.type,
        code: template.code,
        name: template.name,
        version: template.version,
        body: template.body,
        requiresSignature: template.requiresSignature,
        active: true,
        schema: {
          fields: [
            {
              id: "notes",
              label: "Notes / responses",
              type: "textarea",
              required: true,
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });
  }
}

function repairSeedRecord<T>(value: T): T {
  if (typeof value === "string") {
    return repairVietnameseSeedText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(repairSeedRecord) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, repairSeedRecord(item)]),
    ) as T;
  }

  return value;
}

function repairVietnameseSeedText(value: string) {
  if (!/[\u00c3\u00c4\u00c6]|\u00e1[\u00ba\u00bb]/.test(value)) {
    return value;
  }

  return Buffer.from(value, "latin1").toString("utf8");
}

function toFormTemplateSummary(template: {
  id: string;
  type: string;
  code: string;
  name: string;
  version: string;
  body: string | null;
  requiresSignature: boolean;
  active: boolean;
  createdAt: Date;
}): FormTemplateSummary {
  return {
    id: template.id,
    type: template.type as FormTemplateSummary["type"],
    code: template.code,
    name: template.name,
    version: template.version,
    body: template.body,
    requiresSignature: template.requiresSignature,
    active: template.active,
    createdAt: vietnamDateTime(template.createdAt),
    createdAtIso: template.createdAt.toISOString(),
  };
}

function toPatientFormSummary(form: {
  id: string;
  formNo: string;
  patientId: string;
  clinicId: string | null;
  templateId: string;
  status: string;
  responses: Prisma.JsonValue | null;
  signatureUrl: string | null;
  attachments: string[];
  sentAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  patient: {
    fullName: string;
  };
  template: {
    id: string;
    code: string;
    name: string;
    type: string;
    version: string;
    body: string | null;
    requiresSignature: boolean;
  };
  requestedBy: {
    fullName: string;
  } | null;
}): PatientFormSummary {
  return {
    id: form.id,
    formNo: form.formNo,
    patientId: form.patientId,
    patientName: form.patient.fullName,
    clinicId: form.clinicId,
    templateId: form.templateId,
    templateCode: form.template.code,
    templateName: form.template.name,
    templateType: form.template.type as FormTemplateSummary["type"],
    templateVersion: form.template.version,
    templateBody: form.template.body,
    requiresSignature: form.template.requiresSignature,
    requestedByName: form.requestedBy?.fullName ?? null,
    status: form.status as PatientFormSummary["status"],
    responseText: responseText(form.responses),
    signatureUrl: form.signatureUrl,
    attachments: form.attachments,
    sentAt: form.sentAt ? vietnamDateTime(form.sentAt) : null,
    sentAtIso: form.sentAt?.toISOString() ?? null,
    completedAt: form.completedAt ? vietnamDateTime(form.completedAt) : null,
    completedAtIso: form.completedAt?.toISOString() ?? null,
    expiresAt: form.expiresAt ? vietnamDate(form.expiresAt) : null,
    expiresAtIso: form.expiresAt?.toISOString() ?? null,
    createdAt: vietnamDateTime(form.createdAt),
    createdAtIso: form.createdAt.toISOString(),
  };
}

function responseText(value: Prisma.JsonValue | null) {
  if (!value) {
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const notes = (value as { notes?: unknown }).notes;

    return typeof notes === "string" && notes.trim().length > 0
      ? notes.trim()
      : JSON.stringify(value);
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function databaseUserId(userId: string) {
  return userId.startsWith("demo-") ? null : userId;
}

async function fallbackClinic(session: AppSession) {
  const clinicId = session.activeClinicId ?? session.clinicIds[0];

  if (!clinicId) {
    return null;
  }

  return prisma.clinic.findFirst({
    where: {
      id: clinicId,
      organizationId: session.organizationId,
    },
    select: {
      name: true,
      city: true,
    },
  });
}

function ageFromDate(dateOfBirth: Date) {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDelta = today.getMonth() - dateOfBirth.getMonth();

  if (
    monthDelta < 0 ||
    (monthDelta === 0 && today.getDate() < dateOfBirth.getDate())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

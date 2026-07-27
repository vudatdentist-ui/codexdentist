import "server-only";

import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bootstrapOrganizationDefaults } from "@/lib/tenant-bootstrap";

type OrganizationWorkspaceInput = {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerPassword: string;
  clinicName: string;
  city: string;
  address: string;
  isDemo?: boolean;
  demoExpiresAt?: Date | null;
  seedDemoData?: boolean;
  requireEmptyDatabase?: boolean;
};

const firstRunLockId = 2026072701;

export class FirstRunAlreadyCompletedError extends Error {
  constructor() {
    super("First-run setup has already been completed.");
    this.name = "FirstRunAlreadyCompletedError";
  }
}

export async function createOrganizationWorkspace(input: OrganizationWorkspaceInput) {
  const passwordHash = hashPassword(input.ownerPassword);
  const suffix = randomBytes(5).toString("hex");

  const workspace = await prisma.$transaction(async (tx) => {
    if (input.requireEmptyDatabase) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${firstRunLockId})`;

      if ((await tx.organization.count()) > 0) {
        throw new FirstRunAlreadyCompletedError();
      }
    }

    const organization = await tx.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        primaryDomain: null,
        isDemo: input.isDemo ?? false,
        demoExpiresAt: input.demoExpiresAt ?? null,
      },
    });
    const chain = await tx.chain.create({
      data: {
        organizationId: organization.id,
        name: input.name,
        brandName: input.name,
      },
    });
    const clinic = await tx.clinic.create({
      data: {
        organizationId: organization.id,
        chainId: chain.id,
        name: input.clinicName,
        city: input.city,
        address: input.address,
      },
    });
    const owner = await tx.user.create({
      data: {
        organizationId: organization.id,
        email: input.ownerEmail,
        fullName: input.ownerFullName,
        passwordHash,
        role: "OWNER",
        active: true,
        mustChangePassword: false,
      },
    });

    await Promise.all([
      tx.chain.update({
        where: { id: chain.id },
        data: { ownerId: owner.id },
      }),
      tx.userClinic.create({
        data: {
          userId: owner.id,
          clinicId: clinic.id,
        },
      }),
      tx.userRoleAssignment.create({
        data: {
          organizationId: organization.id,
          userId: owner.id,
          clinicId: null,
          scopeKey: "GLOBAL",
          role: "OWNER",
          active: true,
        },
      }),
      tx.chair.createMany({
        data: [
          {
            clinicId: clinic.id,
            name: "Ghế 01",
            specialty: "Tổng quát",
          },
          {
            clinicId: clinic.id,
            name: "Ghế 02",
            specialty: "Phẫu thuật",
          },
        ],
      }),
    ]);

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: owner.id,
        action: input.isDemo ? "demo.workspace_created" : "organization.setup_completed",
        entityType: "Organization",
        entityId: organization.id,
        metadata: {
          expiresAt: input.demoExpiresAt?.toISOString() ?? null,
          source: input.isDemo ? "public-demo" : "first-run",
        },
      },
    });

    return {
      organization,
      clinic,
      owner,
      suffix,
    };
  });

  await bootstrapOrganizationDefaults({
    organizationId: workspace.organization.id,
    organizationName: workspace.organization.name,
    organizationSlug: workspace.organization.slug,
    organizationDomain: workspace.organization.primaryDomain,
    ownerUserId: workspace.owner.id,
    ownerEmail: workspace.owner.email,
    ownerFullName: workspace.owner.fullName,
  });

  if (input.seedDemoData) {
    await seedDemoWorkspace({
      organizationId: workspace.organization.id,
      clinicId: workspace.clinic.id,
      passwordHash,
      suffix: workspace.suffix,
    });
  }

  return workspace;
}

async function seedDemoWorkspace(input: {
  organizationId: string;
  clinicId: string;
  passwordHash: string;
  suffix: string;
}) {
  const now = Date.now();
  const at = (hoursFromNow: number) => new Date(now + hoursFromNow * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const dentist = await tx.user.create({
      data: {
        organizationId: input.organizationId,
        email: `dentist+${input.suffix}@demo.codexdentist.local`,
        fullName: "BS. Nguyễn Minh Anh",
        passwordHash: input.passwordHash,
        role: "DENTIST",
        active: true,
        clinics: {
          create: {
            clinicId: input.clinicId,
          },
        },
      },
    });
    const frontDesk = await tx.user.create({
      data: {
        organizationId: input.organizationId,
        email: `frontdesk+${input.suffix}@demo.codexdentist.local`,
        fullName: "Trần Thu Hà",
        passwordHash: input.passwordHash,
        role: "FRONT_DESK",
        active: true,
        clinics: {
          create: {
            clinicId: input.clinicId,
          },
        },
      },
    });

    await tx.userRoleAssignment.createMany({
      data: [
        {
          organizationId: input.organizationId,
          userId: dentist.id,
          clinicId: input.clinicId,
          scopeKey: input.clinicId,
          role: "DENTIST",
          active: true,
        },
        {
          organizationId: input.organizationId,
          userId: frontDesk.id,
          clinicId: input.clinicId,
          scopeKey: input.clinicId,
          role: "FRONT_DESK",
          active: true,
        },
      ],
    });
    await tx.staffProfile.createMany({
      data: [
        {
          organizationId: input.organizationId,
          userId: dentist.id,
          clinicId: input.clinicId,
          employeeCode: `BS-${input.suffix.slice(0, 6)}`,
          title: "Bác sĩ",
          department: "Lâm sàng",
          active: true,
        },
        {
          organizationId: input.organizationId,
          userId: frontDesk.id,
          clinicId: input.clinicId,
          employeeCode: `LT-${input.suffix.slice(0, 6)}`,
          title: "Lễ tân",
          department: "Vận hành",
          active: true,
        },
      ],
    });

    const patients = await Promise.all([
      tx.patient.create({
        data: {
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          fullName: "Nguyễn Hoàng Nam",
          dateOfBirth: new Date("1989-04-12T00:00:00.000Z"),
          phone: "0901000001",
          gender: "Nam",
          visitReason: "Khám tổng quát và cạo vôi",
          leadSource: "FACEBOOK",
          medicalAlerts: ["Dị ứng Penicillin"],
        },
      }),
      tx.patient.create({
        data: {
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          fullName: "Lê Bảo Ngọc",
          dateOfBirth: new Date("1996-09-28T00:00:00.000Z"),
          phone: "0901000002",
          gender: "Nữ",
          visitReason: "Tư vấn chỉnh nha",
          leadSource: "REFERRAL",
          medicalAlerts: [],
        },
      }),
      tx.patient.create({
        data: {
          organizationId: input.organizationId,
          clinicId: input.clinicId,
          fullName: "Phạm Gia Huy",
          dateOfBirth: new Date("2014-02-08T00:00:00.000Z"),
          phone: "0901000003",
          gender: "Nam",
          guardianName: "Phạm Quốc Tuấn",
          visitReason: "Khám răng trẻ em",
          leadSource: "WALK_IN",
          medicalAlerts: [],
        },
      }),
    ]);
    const chairs = await tx.chair.findMany({
      where: { clinicId: input.clinicId },
      orderBy: { name: "asc" },
      take: 2,
    });

    await tx.appointment.createMany({
      data: [
        {
          clinicId: input.clinicId,
          patientId: patients[0].id,
          providerId: dentist.id,
          chairId: chairs[0]?.id ?? null,
          status: "CONFIRMED",
          startsAt: at(1),
          endsAt: at(2),
          reason: "Khám tổng quát",
          source: "demo",
        },
        {
          clinicId: input.clinicId,
          patientId: patients[1].id,
          providerId: dentist.id,
          chairId: chairs[1]?.id ?? null,
          status: "ARRIVED",
          startsAt: at(-0.5),
          endsAt: at(0.5),
          reason: "Tư vấn chỉnh nha",
          source: "demo",
        },
        {
          clinicId: input.clinicId,
          patientId: patients[2].id,
          providerId: dentist.id,
          chairId: chairs[0]?.id ?? null,
          status: "REQUESTED",
          startsAt: at(25),
          endsAt: at(25.75),
          reason: "Khám răng trẻ em",
          source: "demo",
        },
      ],
    });
    await tx.clinicalNote.create({
      data: {
        patientId: patients[0].id,
        authorId: dentist.id,
        subjective: "Ê buốt nhẹ khi uống lạnh.",
        objective: "Cao răng mức độ trung bình, nướu viêm nhẹ.",
        assessment: "Viêm nướu do mảng bám.",
        plan: "Cạo vôi, đánh bóng và hướng dẫn vệ sinh răng miệng.",
        lockedAt: new Date(),
      },
    });
  });
}

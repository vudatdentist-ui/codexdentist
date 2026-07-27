const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { pbkdf2Sync, randomBytes } = require("crypto");

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const organizationId = "org_nhavista";
const demoPasswordHash = hashPassword("demo1234");
const seedBaseDateKey =
  process.env.SEED_BASE_DATE ||
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

function seedDateTime(daysOffset, time) {
  const date = new Date(`${seedBaseDateKey}T00:00:00+07:00`);
  date.setDate(date.getDate() + daysOffset);
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);

  return `${dateKey}T${time}+07:00`;
}

function seedDate(daysOffset, time = "09:00:00") {
  return new Date(seedDateTime(daysOffset, time));
}

const clinics = [
  {
    id: "hcm-q1",
    name: "Saigon District 1",
    city: "Ho Chi Minh City",
    address: "12 Le Loi, District 1, Ho Chi Minh City",
    phone: "+84 28 1000 1000",
    chairs: 8,
  },
  {
    id: "hn-tayho",
    name: "Ha Noi Tay Ho",
    city: "Ha Noi",
    address: "22 Xuan Dieu, Tay Ho, Ha Noi",
    phone: "+84 24 2000 2000",
    chairs: 6,
  },
  {
    id: "dn-haichau",
    name: "Da Nang Hai Chau",
    city: "Da Nang",
    address: "8 Bach Dang, Hai Chau, Da Nang",
    phone: "+84 236 3000 3000",
    chairs: 5,
  },
  {
    id: "ct-ninhkieu",
    name: "Can Tho Ninh Kieu",
    city: "Can Tho",
    address: "18 Hoa Binh, Ninh Kieu, Can Tho",
    phone: "+84 292 4000 4000",
    chairs: 4,
  },
];

const users = [
  {
    id: "user-owner",
    email: "owner@nhavista.vn",
    fullName: "Nguyen Lan Anh",
    role: "OWNER",
    clinicIds: clinics.map((clinic) => clinic.id),
  },
  {
    id: "user-manager",
    email: "manager@nhavista.vn",
    fullName: "Tran Quoc Minh",
    role: "CLINIC_MANAGER",
    clinicIds: ["hcm-q1", "hn-tayho"],
  },
  {
    id: "user-dentist",
    email: "dentist@nhavista.vn",
    fullName: "Dr. Linh Tran",
    role: "DENTIST",
    clinicIds: ["hcm-q1"],
  },
  {
    id: "user-dentist-vu-tien-dat",
    email: "dat.vu@nhavista.vn",
    fullName: "Vu Tien Dat",
    role: "DENTIST",
    clinicIds: ["hcm-q1", "hn-tayho"],
  },
  {
    id: "user-dentist-nguyen-minh-khoa",
    email: "khoa.nguyen@nhavista.vn",
    fullName: "Nguyen Minh Khoa",
    role: "DENTIST",
    clinicIds: ["hcm-q1"],
  },
  {
    id: "user-dentist-tran-thao-linh",
    email: "linh.tran@nhavista.vn",
    fullName: "Tran Thao Linh",
    role: "DENTIST",
    clinicIds: ["hn-tayho"],
  },
  {
    id: "user-dentist-le-hoang-nam",
    email: "nam.le@nhavista.vn",
    fullName: "Le Hoang Nam",
    role: "DENTIST",
    clinicIds: ["dn-haichau"],
  },
  {
    id: "user-dentist-pham-anh-thu",
    email: "thu.pham@nhavista.vn",
    fullName: "Pham Anh Thu",
    role: "DENTIST",
    clinicIds: ["ct-ninhkieu"],
  },
  {
    id: "user-hygienist-do-ha-my",
    email: "my.do@nhavista.vn",
    fullName: "Do Ha My",
    role: "HYGIENIST",
    clinicIds: ["dn-haichau", "ct-ninhkieu"],
  },
  {
    id: "user-frontdesk",
    email: "frontdesk@nhavista.vn",
    fullName: "Pham Gia Han",
    role: "FRONT_DESK",
    clinicIds: ["hcm-q1"],
  },
  {
    id: "user-billing",
    email: "billing@nhavista.vn",
    fullName: "Le Hoang Bao",
    role: "BILLING",
    clinicIds: ["hcm-q1", "hn-tayho", "dn-haichau", "ct-ninhkieu"],
  },
  {
    id: "user-area",
    email: "area@nhavista.vn",
    fullName: "Ho Thi Mai",
    role: "AREA_MANAGER",
    clinicIds: clinics.map((clinic) => clinic.id),
  },
  {
    id: "user-hygienist",
    email: "hygienist@nhavista.vn",
    fullName: "Nguyen Thao Vy",
    role: "HYGIENIST",
    clinicIds: ["hcm-q1", "hn-tayho"],
  },
  {
    id: "user-patient-minh-anh",
    email: "patient@nhavista.vn",
    fullName: "Nguyen Minh Anh",
    role: "PATIENT",
    clinicIds: ["hcm-q1"],
  },
];

const patients = [
  {
    id: "patient-minh-anh",
    clinicId: "hcm-q1",
    fullName: "Nguyen Minh Anh",
    dateOfBirth: "1992-02-14",
    phone: "+84 90 123 4567",
    email: "patient@nhavista.vn",
    medicalAlerts: ["Penicillin allergy", "Implant candidate"],
  },
  {
    id: "patient-quoc-bao",
    clinicId: "hcm-q1",
    fullName: "Pham Quoc Bao",
    dateOfBirth: "1985-08-03",
    phone: "+84 91 778 2201",
    email: "quocbao@example.vn",
    medicalAlerts: ["Crown plan", "Payment plan"],
  },
  {
    id: "patient-hoang-vy",
    clinicId: "hn-tayho",
    fullName: "Le Hoang Vy",
    dateOfBirth: "2010-05-18",
    phone: "+84 98 444 1088",
    guardianName: "Le Thi Thu",
    medicalAlerts: ["Guardian consent", "Ortho"],
  },
  {
    id: "patient-gia-han",
    clinicId: "dn-haichau",
    fullName: "Do Gia Han",
    dateOfBirth: "2018-09-02",
    phone: "+84 93 666 4500",
    guardianName: "Do Minh Khang",
    medicalAlerts: ["Pediatric", "Recall in 6 months"],
  },
  {
    id: "patient-bao-chau",
    clinicId: "ct-ninhkieu",
    fullName: "Tran Bao Chau",
    dateOfBirth: "1997-12-21",
    phone: "+84 94 390 7781",
    email: "baochau@example.vn",
    medicalAlerts: ["Endodontics", "Follow-up needed"],
  },
];

const appointments = [
  {
    id: "appointment-implant-consult",
    clinicId: "hcm-q1",
    patientId: "patient-minh-anh",
    providerId: "user-dentist",
    chairId: "hcm-q1-chair-2",
    status: "IN_CHAIR",
    startsAt: seedDateTime(0, "08:00:00"),
    endsAt: seedDateTime(0, "09:00:00"),
    reason: "Implant consult",
  },
  {
    id: "appointment-crown-prep",
    clinicId: "hcm-q1",
    patientId: "patient-quoc-bao",
    providerId: "user-dentist",
    chairId: "hcm-q1-chair-5",
    status: "ARRIVED",
    startsAt: seedDateTime(0, "09:30:00"),
    endsAt: seedDateTime(0, "11:00:00"),
    reason: "Crown prep",
  },
  {
    id: "appointment-recall-hoang-vy",
    clinicId: "hn-tayho",
    patientId: "patient-hoang-vy",
    providerId: "user-hygienist",
    chairId: "hn-tayho-chair-1",
    status: "CONFIRMED",
    startsAt: seedDateTime(0, "10:15:00"),
    endsAt: seedDateTime(0, "11:00:00"),
    reason: "Ortho recall",
  },
  {
    id: "appointment-child-gia-han",
    clinicId: "dn-haichau",
    patientId: "patient-gia-han",
    providerId: "user-manager",
    chairId: "dn-haichau-chair-1",
    status: "REQUESTED",
    startsAt: seedDateTime(1, "14:00:00"),
    endsAt: seedDateTime(1, "14:45:00"),
    reason: "Pediatric cleaning",
  },
  {
    id: "appointment-endo-bao-chau",
    clinicId: "ct-ninhkieu",
    patientId: "patient-bao-chau",
    providerId: "user-billing",
    chairId: "ct-ninhkieu-chair-2",
    status: "CONFIRMED",
    startsAt: seedDateTime(1, "15:00:00"),
    endsAt: seedDateTime(1, "16:00:00"),
    reason: "Endodontic follow-up",
  },
];

async function main() {
  await prisma.organization.upsert({
    where: { id: organizationId },
    update: {
      name: "CodexMed OS",
      legalName: "CodexMed OS JSC",
      taxCode: "0312345678",
      locale: "vi-VN",
    },
    create: {
      id: organizationId,
      name: "CodexMed OS",
      legalName: "CodexMed OS JSC",
      taxCode: "0312345678",
      locale: "vi-VN",
    },
  });

  for (const clinic of clinics) {
    await prisma.clinic.upsert({
      where: { id: clinic.id },
      update: {
        name: clinic.name,
        city: clinic.city,
        address: clinic.address,
        phone: clinic.phone,
      },
      create: {
        id: clinic.id,
        organizationId,
        name: clinic.name,
        city: clinic.city,
        address: clinic.address,
        phone: clinic.phone,
      },
    });

    for (let index = 1; index <= clinic.chairs; index += 1) {
      await prisma.chair.upsert({
        where: { id: `${clinic.id}-chair-${index}` },
        update: {
          name: `Chair ${index}`,
          active: true,
        },
        create: {
          id: `${clinic.id}-chair-${index}`,
          clinicId: clinic.id,
          name: `Chair ${index}`,
          active: true,
        },
      });
    }
  }

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        fullName: user.fullName,
        passwordHash: demoPasswordHash,
        role: user.role,
        active: true,
      },
      create: {
        id: user.id,
        organizationId,
        email: user.email,
        fullName: user.fullName,
        passwordHash: demoPasswordHash,
        role: user.role,
        active: true,
      },
    });

    for (const clinicId of user.clinicIds) {
      await prisma.userClinic.upsert({
        where: {
          userId_clinicId: {
            userId: user.id,
            clinicId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          clinicId,
        },
      });
    }
  }

  for (const patient of patients) {
    await prisma.patient.upsert({
      where: {
        organizationId_phone: {
          organizationId,
          phone: patient.phone,
        },
      },
      update: {
        clinicId: patient.clinicId,
        fullName: patient.fullName,
        email: patient.email,
        portalUserId:
          users.find((user) => user.role === "PATIENT" && user.email === patient.email)?.id ??
          null,
        guardianName: patient.guardianName,
        medicalAlerts: patient.medicalAlerts,
      },
      create: {
        id: patient.id,
        organizationId,
        clinicId: patient.clinicId,
        fullName: patient.fullName,
        dateOfBirth: new Date(patient.dateOfBirth),
        phone: patient.phone,
        email: patient.email,
        portalUserId:
          users.find((user) => user.role === "PATIENT" && user.email === patient.email)?.id ??
          null,
        guardianName: patient.guardianName,
        medicalAlerts: patient.medicalAlerts,
      },
    });

    await prisma.patientConsent.upsert({
      where: { id: `${patient.id}-consent-health-data` },
      update: {
        status: "GRANTED",
        version: "vn-simple-v1",
      },
      create: {
        id: `${patient.id}-consent-health-data`,
        patientId: patient.id,
        status: "GRANTED",
        purpose: "Health data processing for dental care",
        channel: "front_desk",
        signedAt: new Date("2026-04-20T09:00:00+07:00"),
        version: "vn-simple-v1",
      },
    });
  }

  for (const appointment of appointments) {
    await prisma.appointment.upsert({
      where: { id: appointment.id },
      update: {
        status: appointment.status,
        startsAt: new Date(appointment.startsAt),
        endsAt: new Date(appointment.endsAt),
        reason: appointment.reason,
      },
      create: {
        id: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        providerId: appointment.providerId,
        chairId: appointment.chairId,
        status: appointment.status,
        startsAt: new Date(appointment.startsAt),
        endsAt: new Date(appointment.endsAt),
        reason: appointment.reason,
      },
    });
  }

  await prisma.treatmentPlan.upsert({
    where: { id: "plan-implant-minh-anh" },
    update: {
      title: "Implant restoration, lower molar",
      status: "PRESENTED",
      totalAmount: 39000000,
      patientDue: 39000000,
    },
    create: {
      id: "plan-implant-minh-anh",
      patientId: "patient-minh-anh",
      title: "Implant restoration, lower molar",
      status: "PRESENTED",
      totalAmount: 39000000,
      patientDue: 39000000,
    },
  });

  await prisma.treatmentPhase.upsert({
    where: { id: "phase-implant-planning" },
    update: {
      name: "Surgical planning",
      procedures: ["CBCT review", "Consent packet", "Deposit invoice"],
      estimatedAmount: 39000000,
    },
    create: {
      id: "phase-implant-planning",
      treatmentPlanId: "plan-implant-minh-anh",
      name: "Surgical planning",
      sequence: 1,
      procedures: ["CBCT review", "Consent packet", "Deposit invoice"],
      estimatedAmount: 39000000,
    },
  });

  await prisma.treatmentPlan.upsert({
    where: { id: "plan-ortho-hoang-vy" },
    update: {
      title: "Ortho refinement and retention",
      status: "ACCEPTED",
      totalAmount: 18000000,
      patientDue: 12000000,
    },
    create: {
      id: "plan-ortho-hoang-vy",
      patientId: "patient-hoang-vy",
      title: "Ortho refinement and retention",
      status: "ACCEPTED",
      totalAmount: 18000000,
      patientDue: 12000000,
    },
  });

  await prisma.treatmentPhase.upsert({
    where: { id: "phase-ortho-refinement" },
    update: {
      name: "Refinement",
      procedures: ["Bracket check", "Retention scan", "Guardian approval"],
      estimatedAmount: 12000000,
    },
    create: {
      id: "phase-ortho-refinement",
      treatmentPlanId: "plan-ortho-hoang-vy",
      name: "Refinement",
      sequence: 1,
      procedures: ["Bracket check", "Retention scan", "Guardian approval"],
      estimatedAmount: 12000000,
    },
  });

  await prisma.treatmentPlan.upsert({
    where: { id: "plan-endo-bao-chau" },
    update: {
      title: "Endodontic retreatment",
      status: "IN_PROGRESS",
      totalAmount: 9500000,
      patientDue: 5000000,
    },
    create: {
      id: "plan-endo-bao-chau",
      patientId: "patient-bao-chau",
      title: "Endodontic retreatment",
      status: "IN_PROGRESS",
      totalAmount: 9500000,
      patientDue: 5000000,
    },
  });

  await prisma.treatmentPhase.upsert({
    where: { id: "phase-endo-cleaning" },
    update: {
      name: "Retreatment",
      procedures: ["Canal cleaning", "Temporary restoration", "Follow-up imaging"],
      estimatedAmount: 9500000,
    },
    create: {
      id: "phase-endo-cleaning",
      treatmentPlanId: "plan-endo-bao-chau",
      name: "Retreatment",
      sequence: 1,
      procedures: ["Canal cleaning", "Temporary restoration", "Follow-up imaging"],
      estimatedAmount: 9500000,
    },
  });

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNo: {
        organizationId,
        invoiceNo: "INV-2304",
      },
    },
    update: {
      status: "OPEN",
      amount: 9800000,
      paidAmount: 0,
      dueDate: new Date("2026-04-30T23:59:00+07:00"),
    },
    create: {
      id: "invoice-2304",
      organizationId,
      clinicId: "hcm-q1",
      patientId: "patient-quoc-bao",
      invoiceNo: "INV-2304",
      status: "OPEN",
      amount: 9800000,
      paidAmount: 0,
      dueDate: new Date("2026-04-30T23:59:00+07:00"),
    },
  });

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNo: {
        organizationId,
        invoiceNo: "INV-2297",
      },
    },
    update: {
      status: "PARTIAL",
      amount: 4200000,
      paidAmount: 1500000,
      dueDate: new Date("2026-05-02T23:59:00+07:00"),
    },
    create: {
      id: "invoice-2297",
      organizationId,
      clinicId: "hcm-q1",
      patientId: "patient-minh-anh",
      invoiceNo: "INV-2297",
      status: "PARTIAL",
      amount: 4200000,
      paidAmount: 1500000,
      dueDate: new Date("2026-05-02T23:59:00+07:00"),
    },
  });

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNo: {
        organizationId,
        invoiceNo: "INV-2288",
      },
    },
    update: {
      status: "OPEN",
      amount: 2500000,
      paidAmount: 0,
      dueDate: new Date("2026-04-18T23:59:00+07:00"),
    },
    create: {
      id: "invoice-2288",
      organizationId,
      clinicId: "ct-ninhkieu",
      patientId: "patient-bao-chau",
      invoiceNo: "INV-2288",
      status: "OPEN",
      amount: 2500000,
      paidAmount: 0,
      dueDate: new Date("2026-04-18T23:59:00+07:00"),
    },
  });

  await prisma.invoice.upsert({
    where: {
      organizationId_invoiceNo: {
        organizationId,
        invoiceNo: "INV-2275",
      },
    },
    update: {
      status: "PAID",
      amount: 850000,
      paidAmount: 850000,
      dueDate: new Date("2026-04-22T23:59:00+07:00"),
    },
    create: {
      id: "invoice-2275",
      organizationId,
      clinicId: "dn-haichau",
      patientId: "patient-gia-han",
      invoiceNo: "INV-2275",
      status: "PAID",
      amount: 850000,
      paidAmount: 850000,
      dueDate: new Date("2026-04-22T23:59:00+07:00"),
    },
  });

  const seededInvoices = await prisma.invoice.findMany({
    where: {
      invoiceNo: {
        in: ["INV-2304", "INV-2297", "INV-2288", "INV-2275"],
      },
    },
    include: {
      patient: {
        select: {
          organizationId: true,
        },
      },
      items: {
        select: {
          id: true,
        },
      },
    },
  });

  for (const invoice of seededInvoices) {
    if (invoice.items.length > 0) {
      continue;
    }

    await prisma.invoiceItem.create({
      data: {
        organizationId: invoice.patient.organizationId,
        clinicId: invoice.clinicId,
        patientId: invoice.patientId,
        invoiceId: invoice.id,
        treatmentServiceId: null,
        description: "Manual patient invoice",
        quantity: 1,
        unitPrice: invoice.amount,
        amount: invoice.amount,
      },
    });
  }

  await prisma.clinicalNote.upsert({
    where: { id: "note-minh-anh-implant" },
    update: {
      subjective: "Patient reports mild soreness after previous consult.",
      objective: "Soft tissue response normal. CBCT review pending.",
      assessment: "Implant candidate remains suitable.",
      plan: "Confirm consent, finalize surgical guide, collect deposit.",
    },
    create: {
      id: "note-minh-anh-implant",
      patientId: "patient-minh-anh",
      authorId: "user-dentist",
      subjective: "Patient reports mild soreness after previous consult.",
      objective: "Soft tissue response normal. CBCT review pending.",
      assessment: "Implant candidate remains suitable.",
      plan: "Confirm consent, finalize surgical guide, collect deposit.",
    },
  });

  await prisma.clinicalNote.upsert({
    where: { id: "note-hoang-vy-ortho" },
    update: {
      subjective: "Guardian reports patient is comfortable with aligner wear.",
      objective: "Minor crowding remains on lower anterior segment.",
      assessment: "Refinement phase appropriate.",
      plan: "Proceed with retention scan and guardian approval.",
      lockedAt: new Date("2026-04-24T16:00:00+07:00"),
    },
    create: {
      id: "note-hoang-vy-ortho",
      patientId: "patient-hoang-vy",
      authorId: "user-hygienist",
      subjective: "Guardian reports patient is comfortable with aligner wear.",
      objective: "Minor crowding remains on lower anterior segment.",
      assessment: "Refinement phase appropriate.",
      plan: "Proceed with retention scan and guardian approval.",
      lockedAt: new Date("2026-04-24T16:00:00+07:00"),
    },
  });

  await prisma.communityPost.upsert({
    where: { id: "post-implant-handoff" },
    update: {
      title: "Implant consult queue needs CBCT review",
      body: "Three implant consults are waiting for CBCT sign-off before treatment plan approval.",
      tags: ["implant", "handoff"],
    },
    create: {
      id: "post-implant-handoff",
      organizationId,
      clinicId: "hcm-q1",
      authorId: "user-dentist",
      type: "SHIFT_HANDOFF",
      title: "Implant consult queue needs CBCT review",
      body: "Three implant consults are waiting for CBCT sign-off before treatment plan approval.",
      tags: ["implant", "handoff"],
    },
  });

  await prisma.communityPost.upsert({
    where: { id: "post-consent-rollout" },
    update: {
      title: "Updated patient consent script",
      body: "Front desk should use the simple Vietnamese consent script for every new patient profile.",
      tags: ["consent", "front-desk"],
    },
    create: {
      id: "post-consent-rollout",
      organizationId,
      clinicId: null,
      authorId: "user-area",
      type: "POLICY",
      title: "Updated patient consent script",
      body: "Front desk should use the simple Vietnamese consent script for every new patient profile.",
      tags: ["consent", "front-desk"],
    },
  });

  await prisma.communityPost.upsert({
    where: { id: "post-pediatric-recall" },
    update: {
      title: "Pediatric recall checklist",
      body: "Da Nang team reduced missed recalls by calling guardians two days before the visit.",
      tags: ["training", "recall"],
    },
    create: {
      id: "post-pediatric-recall",
      organizationId,
      clinicId: "dn-haichau",
      authorId: "user-manager",
      type: "TRAINING",
      title: "Pediatric recall checklist",
      body: "Da Nang team reduced missed recalls by calling guardians two days before the visit.",
      tags: ["training", "recall"],
    },
  });

  await prisma.postComment.upsert({
    where: { id: "comment-implant-review" },
    update: {
      body: "I can review the CBCT queue before lunch and mark the urgent cases.",
    },
    create: {
      id: "comment-implant-review",
      postId: "post-implant-handoff",
      authorId: "user-hygienist",
      body: "I can review the CBCT queue before lunch and mark the urgent cases.",
    },
  });

  await prisma.postComment.upsert({
    where: { id: "comment-consent-rollout" },
    update: {
      body: "Please pin this for the first week and check audit logs daily.",
    },
    create: {
      id: "comment-consent-rollout",
      postId: "post-consent-rollout",
      authorId: "user-owner",
      body: "Please pin this for the first week and check audit logs daily.",
    },
  });

  await prisma.auditLog.upsert({
    where: { id: "audit-initial-seed" },
    update: {
      action: "seed.completed",
      entityType: "Organization",
      entityId: organizationId,
    },
    create: {
      id: "audit-initial-seed",
      organizationId,
      actorId: "user-owner",
      action: "seed.completed",
      entityType: "Organization",
      entityId: organizationId,
      metadata: {
        environment: "local",
      },
    },
  });
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");

  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

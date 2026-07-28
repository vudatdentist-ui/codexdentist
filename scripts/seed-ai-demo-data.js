const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { pbkdf2Sync } = require("crypto");

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DEMO = "ai-demo";
const ORG_FALLBACK_ID = "org_nhavista";

function dateAt(hour, minute = 0, dayOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function monthEnd() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1, 0);
  date.setHours(23, 59, 59, 999);
  return date;
}

function hashPassword(password, salt = "ai_demo_seed_salt") {
  const hash = pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

async function ensureBase() {
  const organization =
    (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
    (await prisma.organization.create({
      data: {
        id: ORG_FALLBACK_ID,
        name: "CodexMed OS",
        legalName: "CodexMed OS Demo",
        locale: "vi-VN",
      },
    }));

  const clinic =
    (await prisma.clinic.findFirst({
      where: { organizationId: organization.id, active: true },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.clinic.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: "AI Demo Clinic" } },
      create: {
        id: `${DEMO}-clinic-main`,
        organizationId: organization.id,
        name: "AI Demo Clinic",
        city: "Ha Noi",
        address: "Demo address",
        phone: "0900000000",
        active: true,
      },
      update: { active: true },
    }));

  const actor =
    (await prisma.user.findFirst({
      where: { organizationId: organization.id, active: true, role: { in: ["OWNER", "CLINIC_MANAGER"] } },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.user.findFirst({
      where: { organizationId: organization.id, active: true },
      orderBy: { createdAt: "asc" },
    }));

  if (!actor) {
    throw new Error("No active user found. Create one owner account before seeding AI demo data.");
  }

  return { organization, clinic, actor };
}

async function seedChairs(clinicId) {
  const chairs = [
    { id: `${DEMO}-chair-1`, name: "Ghế 01", specialty: "Tổng quát" },
    { id: `${DEMO}-chair-2`, name: "Ghế 02", specialty: "Chỉnh nha" },
    { id: `${DEMO}-chair-3`, name: "Ghế 03", specialty: "Phẫu thuật" },
  ];

  return Promise.all(
    chairs.map((chair) =>
      prisma.chair.upsert({
        where: { clinicId_name: { clinicId, name: chair.name } },
        create: { ...chair, clinicId, active: true, operationalStatus: "READY" },
        update: { specialty: chair.specialty, active: true, operationalStatus: "READY" },
      }),
    ),
  );
}

async function seedUsersAndStaff(organizationId, clinicId, actorId) {
  const passwordHash = hashPassword("demo1234");
  const users = [
    {
      id: `${DEMO}-dentist-1`,
      email: "ai.demo.dentist@codexmed.local",
      fullName: "BS. Minh Anh",
      role: "DENTIST",
      title: "Bác sĩ điều trị",
      department: "Lâm sàng",
      employeeCode: "AI-BS01",
      baseSalary: "18000000",
      gender: "Nữ",
    },
    {
      id: `${DEMO}-assistant-1`,
      email: "ai.demo.assistant@codexmed.local",
      fullName: "Trợ thủ Gia Hân",
      role: "HYGIENIST",
      title: "Phụ tá",
      department: "Lâm sàng",
      employeeCode: "AI-PT01",
      baseSalary: "9000000",
      gender: "Nữ",
    },
    {
      id: `${DEMO}-frontdesk-1`,
      email: "ai.demo.frontdesk@codexmed.local",
      fullName: "Lễ tân Hoàng Nam",
      role: "FRONT_DESK",
      title: "Lễ tân",
      department: "Vận hành",
      employeeCode: "AI-LT01",
      baseSalary: "11000000",
      gender: "Nam",
    },
    {
      id: `${DEMO}-billing-1`,
      email: "ai.demo.billing@codexmed.local",
      fullName: "Kế toán Thu Hà",
      role: "BILLING",
      title: "Kế toán phòng khám",
      department: "Tài chính",
      employeeCode: "AI-KT01",
      baseSalary: "13000000",
      gender: "Nữ",
    },
  ];

  const created = [];
  for (const user of users) {
    const savedUser = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        id: user.id,
        organizationId,
        email: user.email,
        fullName: user.fullName,
        passwordHash,
        role: user.role,
        active: true,
        operationalStatus: "READY",
        mustChangePassword: false,
      },
      update: {
        fullName: user.fullName,
        role: user.role,
        active: true,
        operationalStatus: "READY",
        mustChangePassword: false,
      },
    });

    await prisma.userClinic.upsert({
      where: { userId_clinicId: { userId: savedUser.id, clinicId } },
      create: { userId: savedUser.id, clinicId },
      update: {},
    });

    const profile = await prisma.staffProfile.upsert({
      where: { userId: savedUser.id },
      create: {
        id: `${user.id}-profile`,
        organizationId,
        userId: savedUser.id,
        clinicId,
        employeeCode: user.employeeCode,
        title: user.title,
        department: user.department,
        contractType: "FULL_TIME",
        baseSalary: user.baseSalary,
        hireDate: addDays(-180),
        dateOfBirth: addDays(-365 * 29),
        gender: user.gender,
        active: true,
      },
      update: {
        clinicId,
        title: user.title,
        department: user.department,
        contractType: "FULL_TIME",
        baseSalary: user.baseSalary,
        active: true,
      },
    });

    created.push({ user: savedUser, profile });
  }

  const existingProfiles = await prisma.staffProfile.findMany({
    where: { organizationId, active: true },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  for (const profile of existingProfiles.slice(0, 4)) {
    await prisma.staffShift.upsert({
      where: { id: `${DEMO}-shift-${profile.id}` },
      create: {
        id: `${DEMO}-shift-${profile.id}`,
        organizationId,
        clinicId,
        staffProfileId: profile.id,
        status: "CONFIRMED",
        roleOnShift: profile.title ?? profile.user.role,
        startsAt: dateAt(8, 0, 0),
        endsAt: dateAt(17, 30, 0),
        notes: "Ca demo để AI phân tích tải nhân sự hôm nay.",
      },
      update: {
        clinicId,
        status: "CONFIRMED",
        startsAt: dateAt(8, 0, 0),
        endsAt: dateAt(17, 30, 0),
        notes: "Ca demo để AI phân tích tải nhân sự hôm nay.",
      },
    });

    await prisma.attendanceLog.upsert({
      where: { id: `${DEMO}-attendance-${profile.id}` },
      create: {
        id: `${DEMO}-attendance-${profile.id}`,
        organizationId,
        clinicId,
        staffProfileId: profile.id,
        clockInAt: dateAt(8, profile.user.role === "FRONT_DESK" ? 12 : 3, 0),
        clockOutAt: profile.user.role === "BILLING" ? null : dateAt(17, 18, 0),
        outStatus: profile.user.role === "BILLING" ? "ON_SHIFT" : "DONE",
        note: profile.user.role === "FRONT_DESK" ? "Vào muộn 12 phút." : "Chấm công demo AI.",
        adjusted: false,
      },
      update: {
        clinicId,
        clockInAt: dateAt(8, profile.user.role === "FRONT_DESK" ? 12 : 3, 0),
        clockOutAt: profile.user.role === "BILLING" ? null : dateAt(17, 18, 0),
        outStatus: profile.user.role === "BILLING" ? "ON_SHIFT" : "DONE",
        note: profile.user.role === "FRONT_DESK" ? "Vào muộn 12 phút." : "Chấm công demo AI.",
      },
    });
  }

  const leaveProfile = existingProfiles.find((profile) => profile.user.role === "HYGIENIST") ?? existingProfiles[0];
  if (leaveProfile) {
    await prisma.leaveRequest.upsert({
      where: { id: `${DEMO}-leave-request-1` },
      create: {
        id: `${DEMO}-leave-request-1`,
        organizationId,
        clinicId,
        staffProfileId: leaveProfile.id,
        leaveType: "Nghỉ phép năm",
        status: "REQUESTED",
        startsAt: dateAt(8, 0, 2),
        endsAt: dateAt(17, 30, 2),
        hours: "8.00",
        reason: "Việc gia đình, cần quản lý duyệt trước lịch chỉnh nha đông.",
      },
      update: {
        clinicId,
        staffProfileId: leaveProfile.id,
        status: "REQUESTED",
        startsAt: dateAt(8, 0, 2),
        endsAt: dateAt(17, 30, 2),
        reason: "Việc gia đình, cần quản lý duyệt trước lịch chỉnh nha đông.",
      },
    });
  }

  await seedPayroll(organizationId, clinicId, existingProfiles, actorId);
  return created;
}

async function seedPayroll(organizationId, clinicId, profiles, actorId) {
  const payrollRun = await prisma.payrollRun.upsert({
    where: { id: `${DEMO}-payroll-run-current` },
    create: {
      id: `${DEMO}-payroll-run-current`,
      organizationId,
      clinicId,
      status: "DRAFT",
      periodStart: monthStart(),
      periodEnd: monthEnd(),
      grossAmount: "38500000",
      deductionAmount: "900000",
      netAmount: "37600000",
    },
    update: {
      clinicId,
      status: "DRAFT",
      periodStart: monthStart(),
      periodEnd: monthEnd(),
      grossAmount: "38500000",
      deductionAmount: "900000",
      netAmount: "37600000",
    },
  });

  for (const [index, profile] of profiles.slice(0, 4).entries()) {
    const base = Number(profile.baseSalary ?? 12000000);
    const baseProrated = Math.round((base / 26) * (index === 0 ? 5 : 4));
    const commission = [1800000, 950000, 420000, 0][index] ?? 0;
    const deduction = index === 2 ? 150000 : 0;
    await prisma.payrollLine.upsert({
      where: { payrollRunId_staffProfileId: { payrollRunId: payrollRun.id, staffProfileId: profile.id } },
      create: {
        id: `${DEMO}-payroll-line-${profile.id}`,
        payrollRunId: payrollRun.id,
        staffProfileId: profile.id,
        employeeCode: profile.employeeCode,
        baseAmount: String(baseProrated),
        commissionAmount: String(commission),
        bonusAmount: index === 0 ? "500000" : "0",
        deductionAmount: String(deduction),
        netAmount: String(baseProrated + commission + (index === 0 ? 500000 : 0) - deduction),
        metrics: {
          source: DEMO,
          standardWorkDays: 26,
          workedDaysToDate: index === 0 ? 5 : 4,
          note: "Dòng lương demo cho AI phân tích thu nhập thực nhận.",
        },
      },
      update: {
        employeeCode: profile.employeeCode,
        baseAmount: String(baseProrated),
        commissionAmount: String(commission),
        bonusAmount: index === 0 ? "500000" : "0",
        deductionAmount: String(deduction),
        netAmount: String(baseProrated + commission + (index === 0 ? 500000 : 0) - deduction),
        metrics: {
          source: DEMO,
          standardWorkDays: 26,
          workedDaysToDate: index === 0 ? 5 : 4,
          note: "Dòng lương demo cho AI phân tích thu nhập thực nhận.",
        },
      },
    });
  }

  await prisma.workItem.upsert({
    where: { id: `${DEMO}-workitem-payroll-review` },
    create: {
      id: `${DEMO}-workitem-payroll-review`,
      organizationId,
      clinicId,
      assignedToId: actorId,
      createdById: actorId,
      sourceKind: "AI_DEMO_PAYROLL",
      sourceId: payrollRun.id,
      priority: "high",
      status: "OPEN",
      title: "Rà soát bảng lương demo tháng này",
      detail: "Có 1 nhân sự vào muộn và 1 yêu cầu nghỉ phép đang chờ duyệt.",
      dueAt: dateAt(16, 0, 0),
    },
    update: {
      clinicId,
      assignedToId: actorId,
      status: "OPEN",
      detail: "Có 1 nhân sự vào muộn và 1 yêu cầu nghỉ phép đang chờ duyệt.",
      dueAt: dateAt(16, 0, 0),
    },
  });
}

async function seedPatients(organizationId, clinicId) {
  const patients = [
    {
      id: `${DEMO}-patient-1`,
      fullName: "Nguyễn Thu Trang",
      phone: "0909000101",
      email: "trang.ai.demo@example.com",
      gender: "Nữ",
      dateOfBirth: "1992-02-14",
      visitReason: "Đau răng 46, ê buốt khi ăn lạnh.",
      leadSource: "ADS_FACEBOOK",
      address: "Từ Sơn, Bắc Ninh",
      medicalAlerts: ["Dị ứng Penicillin", "Huyết áp hơi cao"],
    },
    {
      id: `${DEMO}-patient-2`,
      fullName: "Trần Quốc Bảo",
      phone: "0909000102",
      email: "bao.ai.demo@example.com",
      gender: "Nam",
      dateOfBirth: "1986-09-20",
      visitReason: "Tư vấn implant vùng 36, mất răng hơn 1 năm.",
      leadSource: "REFERRAL",
      address: "Quế Võ, Bắc Ninh",
      medicalAlerts: ["Đái tháo đường type 2"],
    },
    {
      id: `${DEMO}-patient-3`,
      fullName: "Lê Mai Phương",
      phone: "0909000103",
      email: "phuong.ai.demo@example.com",
      gender: "Nữ",
      dateOfBirth: "2001-06-08",
      visitReason: "Niềng răng, chen chúc hàm dưới.",
      leadSource: "TIKTOK",
      address: "Bắc Giang",
      medicalAlerts: [],
    },
    {
      id: `${DEMO}-patient-4`,
      fullName: "Phạm Minh Khang",
      phone: "0909000104",
      email: "khang.ai.demo@example.com",
      gender: "Nam",
      dateOfBirth: "2014-11-01",
      visitReason: "Khám răng trẻ em, sâu răng sữa.",
      leadSource: "WALK_IN",
      address: "Yên Phong, Bắc Ninh",
      guardianName: "Phạm Hải Yến",
      medicalAlerts: ["Hen phế quản nhẹ"],
    },
    {
      id: `${DEMO}-patient-5`,
      fullName: "Đỗ Thanh Huyền",
      phone: "0909000105",
      email: "huyen.ai.demo@example.com",
      gender: "Nữ",
      dateOfBirth: "1978-03-03",
      visitReason: "Bọc sứ nhóm răng cửa, yêu cầu thẩm mỹ cao.",
      leadSource: "TELESALE",
      address: "Gia Bình, Bắc Ninh",
      medicalAlerts: ["Đang dùng thuốc chống đông"],
    },
  ];

  const saved = [];
  for (const patient of patients) {
    saved.push(
      await prisma.patient.upsert({
        where: { organizationId_phone: { organizationId, phone: patient.phone } },
        create: {
          id: patient.id,
          organizationId,
          clinicId,
          fullName: patient.fullName,
          phone: patient.phone,
          email: patient.email,
          gender: patient.gender,
          dateOfBirth: new Date(patient.dateOfBirth),
          visitReason: patient.visitReason,
          leadSource: patient.leadSource,
          address: patient.address,
          guardianName: patient.guardianName,
          medicalAlerts: patient.medicalAlerts,
        },
        update: {
          clinicId,
          fullName: patient.fullName,
          email: patient.email,
          gender: patient.gender,
          dateOfBirth: new Date(patient.dateOfBirth),
          visitReason: patient.visitReason,
          leadSource: patient.leadSource,
          address: patient.address,
          guardianName: patient.guardianName,
          medicalAlerts: patient.medicalAlerts,
        },
      }),
    );
  }

  return saved;
}

async function seedServices(organizationId, clinicId) {
  const category = await prisma.serviceCategory.upsert({
    where: { organizationId_code: { organizationId, code: "AI-DEMO-CLINICAL" } },
    create: {
      id: `${DEMO}-service-category`,
      organizationId,
      code: "AI-DEMO-CLINICAL",
      name: "Dịch vụ demo AI",
      nameEn: "AI demo services",
      description: "Nhóm dịch vụ tạo dữ liệu giả cho AI phân tích.",
      sortOrder: 99,
      active: true,
    },
    update: {
      name: "Dịch vụ demo AI",
      description: "Nhóm dịch vụ tạo dữ liệu giả cho AI phân tích.",
      active: true,
    },
  });

  const services = [
    {
      id: `${DEMO}-svc-filling`,
      code: "AI-TRAM46",
      name: "Trám composite răng hàm",
      price: "900000",
      duration: 45,
      targetMode: "TOOTH",
      steps: ["Khám và chụp phim", "Làm sạch xoang sâu", "Trám và chỉnh khớp"],
    },
    {
      id: `${DEMO}-svc-implant`,
      code: "AI-IMPLANT36",
      name: "Cấy implant đơn lẻ",
      price: "22000000",
      duration: 90,
      targetMode: "TOOTH",
      steps: ["Đánh giá phim CT", "Đặt trụ", "Phục hình sứ"],
    },
    {
      id: `${DEMO}-svc-ortho`,
      code: "AI-ORTHO",
      name: "Chỉnh nha mắc cài",
      price: "35000000",
      duration: 60,
      targetMode: "ARCH",
      steps: ["Lấy dấu và kế hoạch", "Gắn mắc cài", "Tái khám siết răng"],
    },
    {
      id: `${DEMO}-svc-crown`,
      code: "AI-CROWN",
      name: "Bọc sứ thẩm mỹ",
      price: "4500000",
      duration: 60,
      targetMode: "TOOTH_GROUP",
      steps: ["Thiết kế nụ cười", "Mài cùi", "Gắn răng sứ"],
    },
  ];

  const saved = [];
  for (const service of services) {
    const item = await prisma.serviceCatalogItem.upsert({
      where: { organizationId_code: { organizationId, code: service.code } },
      create: {
        id: service.id,
        organizationId,
        categoryId: category.id,
        code: service.code,
        name: service.name,
        description: "Dịch vụ demo để kiểm tra AI theo vận hành phòng khám.",
        status: "ACTIVE",
        defaultPrice: service.price,
        defaultDurationMinutes: service.duration,
        targetMode: service.targetMode,
        billable: true,
        taxable: false,
        consentRequired: service.code !== "AI-TRAM46",
        clinicalTemplate: "Mục tiêu, rủi ro, vật tư, lịch hẹn tiếp theo.",
      },
      update: {
        categoryId: category.id,
        name: service.name,
        status: "ACTIVE",
        defaultPrice: service.price,
        defaultDurationMinutes: service.duration,
        targetMode: service.targetMode,
        consentRequired: service.code !== "AI-TRAM46",
      },
    });

    for (const [index, step] of service.steps.entries()) {
      await prisma.serviceStep.upsert({
        where: { serviceId_sequence: { serviceId: item.id, sequence: index + 1 } },
        create: {
          id: `${service.id}-step-${index + 1}`,
          organizationId,
          serviceId: item.id,
          sequence: index + 1,
          name: step,
          description: "Bước demo cho AI kiểm tra tiến độ.",
          expectedMinutes: service.duration,
          defaultProgress: Math.round(((index + 1) / service.steps.length) * 100),
          roleHint: index === 0 ? "CONSULTANT" : "OPERATOR",
          required: true,
        },
        update: {
          name: step,
          description: "Bước demo cho AI kiểm tra tiến độ.",
          expectedMinutes: service.duration,
          defaultProgress: Math.round(((index + 1) / service.steps.length) * 100),
          roleHint: index === 0 ? "CONSULTANT" : "OPERATOR",
          required: true,
        },
      });
    }

    await prisma.servicePrice.upsert({
      where: { id: `${service.id}-price-main` },
      create: {
        id: `${service.id}-price-main`,
        organizationId,
        clinicId,
        serviceId: item.id,
        price: service.price,
        currency: "VND",
        version: "AI-DEMO",
        active: true,
        note: "Giá demo AI.",
      },
      update: { clinicId, price: service.price, active: true, note: "Giá demo AI." },
    });

    saved.push(item);
  }

  return saved;
}

async function seedClinicalJourney(organizationId, clinicId, actorId, patients, users, services, chairs) {
  const dentist = users.find((item) => item.user.role === "DENTIST")?.user ?? { id: actorId };
  const assistant = users.find((item) => item.user.role === "HYGIENIST")?.user;
  const frontdesk = users.find((item) => item.user.role === "FRONT_DESK")?.user ?? { id: actorId };

  const appointmentSpecs = [
    [patients[0], dentist.id, chairs[0]?.id, "IN_CHAIR", dateAt(9, 0, 0), "Đau răng 46, điều trị tủy/trám"],
    [patients[1], dentist.id, chairs[2]?.id, "CONFIRMED", dateAt(14, 0, 0), "Tư vấn implant 36"],
    [patients[2], dentist.id, chairs[1]?.id, "ARRIVED", dateAt(10, 30, 0), "Khám chỉnh nha ban đầu"],
    [patients[3], dentist.id, chairs[0]?.id, "NO_SHOW", dateAt(16, 0, -1), "Tái khám răng trẻ em"],
    [patients[4], dentist.id, chairs[2]?.id, "REQUESTED", dateAt(11, 0, 1), "Tư vấn bọc sứ thẩm mỹ"],
  ];

  for (const [index, [patient, providerId, chairId, status, startsAt, reason]] of appointmentSpecs.entries()) {
    await prisma.appointment.upsert({
      where: { id: `${DEMO}-appointment-${index + 1}` },
      create: {
        id: `${DEMO}-appointment-${index + 1}`,
        clinicId,
        patientId: patient.id,
        providerId,
        chairId,
        status,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        reason,
        source: "ai_demo",
      },
      update: {
        clinicId,
        patientId: patient.id,
        providerId,
        chairId,
        status,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        reason,
        source: "ai_demo",
      },
    });
  }

  const clinicalNotes = [
    {
      patient: patients[0],
      subjective: "Đau âm ỉ răng 46 ba ngày, tăng khi nhai.",
      objective: "Bệnh sử: dị ứng Penicillin. Sinh hiệu: Mạch 78, Nhiệt độ 36.8, Huyết áp 135/85. Sâu mặt nhai 46, gõ đau nhẹ.",
      assessment: "Viêm tủy không hồi phục răng 46, cần tư vấn điều trị tủy hoặc trám phục hồi tùy phim.",
      plan: "Chụp phim, giảm đau an toàn theo tiền sử dị ứng, hẹn xử trí trong ngày.",
    },
    {
      patient: patients[1],
      subjective: "Mất răng 36 hơn 1 năm, muốn phục hồi ăn nhai.",
      objective: "Bệnh sử: ĐTĐ type 2, chưa có HbA1c gần nhất. Nướu vùng mất răng ổn, cần CT đánh giá xương.",
      assessment: "Ứng viên implant cần kiểm soát đường huyết và kế hoạch tài chính.",
      plan: "Yêu cầu xét nghiệm/HbA1c, tư vấn giai đoạn đặt trụ và phục hình.",
    },
    {
      patient: patients[2],
      subjective: "Muốn chỉnh nha do chen chúc và cười hở nhẹ.",
      objective: "Chen chúc hàm dưới, khớp cắn hạng I, vệ sinh răng miệng trung bình.",
      assessment: "Có thể phù hợp chỉnh nha mắc cài, cần phim sọ nghiêng và mẫu hàm.",
      plan: "Tư vấn 2 phương án và lịch gắn mắc cài nếu đồng ý.",
    },
  ];

  for (const [index, note] of clinicalNotes.entries()) {
    await prisma.clinicalNote.upsert({
      where: { id: `${DEMO}-clinical-note-${index + 1}` },
      create: {
        id: `${DEMO}-clinical-note-${index + 1}`,
        patientId: note.patient.id,
        authorId: dentist.id,
        subjective: note.subjective,
        objective: note.objective,
        assessment: note.assessment,
        plan: note.plan,
        createdAt: addDays(-index),
      },
      update: {
        patientId: note.patient.id,
        authorId: dentist.id,
        subjective: note.subjective,
        objective: note.objective,
        assessment: note.assessment,
        plan: note.plan,
      },
    });
  }

  const treatmentSpecs = [
    {
      patient: patients[0],
      title: "Điều trị răng 46",
      goal: "Giảm đau, bảo tồn răng 46 và phục hồi ăn nhai.",
      plan: "Xử trí tủy nếu phim xác nhận viêm tủy, sau đó trám composite và tái khám sau 7 ngày.",
      service: services.find((item) => item.code === "AI-TRAM46"),
      teeth: ["46"],
      status: "IN_PROGRESS",
      progress: "60.00",
      price: "900000",
      collected: "600000",
    },
    {
      patient: patients[1],
      title: "Implant vùng 36",
      goal: "Phục hồi răng mất 36, kiểm soát nguy cơ lành thương do ĐTĐ.",
      plan: "Hoàn tất CT/HbA1c, đặt cọc, phẫu thuật đặt trụ khi chỉ số đường huyết phù hợp.",
      service: services.find((item) => item.code === "AI-IMPLANT36"),
      teeth: ["36"],
      status: "PLANNED",
      progress: "0.00",
      price: "22000000",
      collected: "3000000",
    },
    {
      patient: patients[2],
      title: "Chỉnh nha mắc cài hai hàm",
      goal: "Giảm chen chúc, ổn định khớp cắn và cải thiện thẩm mỹ nụ cười.",
      plan: "Chụp phim, lấy dấu, ký cam kết chỉnh nha, gắn mắc cài trong tuần tới.",
      service: services.find((item) => item.code === "AI-ORTHO"),
      teeth: ["UPPER_ARCH", "LOWER_ARCH"],
      status: "IN_PROGRESS",
      progress: "25.00",
      price: "35000000",
      collected: "8000000",
    },
    {
      patient: patients[4],
      title: "Bọc sứ nhóm răng cửa",
      goal: "Cải thiện màu sắc và hình thể răng cửa, hạn chế xâm lấn quá mức.",
      plan: "Thiết kế smile design, thử mockup trước khi mài, cần kiểm soát thuốc chống đông.",
      service: services.find((item) => item.code === "AI-CROWN"),
      teeth: ["11", "12", "21", "22"],
      status: "PLANNED",
      progress: "0.00",
      price: "18000000",
      collected: "0",
    },
  ];

  for (const [index, spec] of treatmentSpecs.entries()) {
    const plan = await prisma.treatmentPlan.upsert({
      where: { id: `${DEMO}-treatment-plan-${index + 1}` },
      create: {
        id: `${DEMO}-treatment-plan-${index + 1}`,
        patientId: spec.patient.id,
        title: spec.title,
        status: spec.status === "COMPLETED" ? "COMPLETED" : spec.status === "PLANNED" ? "PRESENTED" : "IN_PROGRESS",
        totalAmount: spec.price,
        patientDue: String(Math.max(Number(spec.price) - Number(spec.collected), 0)),
      },
      update: {
        patientId: spec.patient.id,
        title: spec.title,
        status: spec.status === "COMPLETED" ? "COMPLETED" : spec.status === "PLANNED" ? "PRESENTED" : "IN_PROGRESS",
        totalAmount: spec.price,
        patientDue: String(Math.max(Number(spec.price) - Number(spec.collected), 0)),
      },
    });

    await prisma.treatmentPhase.upsert({
      where: { id: `${DEMO}-treatment-phase-${index + 1}` },
      create: {
        id: `${DEMO}-treatment-phase-${index + 1}`,
        treatmentPlanId: plan.id,
        name: index === 1 ? "Giai đoạn chuẩn bị" : "Giai đoạn điều trị chính",
        sequence: 1,
        procedures: [spec.service?.name ?? spec.title],
        estimatedAmount: spec.price,
      },
      update: {
        treatmentPlanId: plan.id,
        name: index === 1 ? "Giai đoạn chuẩn bị" : "Giai đoạn điều trị chính",
        sequence: 1,
        procedures: [spec.service?.name ?? spec.title],
        estimatedAmount: spec.price,
      },
    });

    await prisma.patientJourneyState.upsert({
      where: { patientId: spec.patient.id },
      create: {
        id: `${DEMO}-journey-state-${index + 1}`,
        organizationId,
        clinicId,
        patientId: spec.patient.id,
        treatmentGoal: spec.goal,
        treatmentPlan: spec.plan,
        odontogramTeeth: spec.teeth,
        odontogramSnapshot: { source: DEMO, teeth: spec.teeth, note: "Snapshot demo AI" },
        updatedById: dentist.id,
      },
      update: {
        organizationId,
        clinicId,
        treatmentGoal: spec.goal,
        treatmentPlan: spec.plan,
        odontogramTeeth: spec.teeth,
        odontogramSnapshot: { source: DEMO, teeth: spec.teeth, note: "Snapshot demo AI" },
        updatedById: dentist.id,
      },
    });

    const treatmentService = await prisma.treatmentService.upsert({
      where: { id: `${DEMO}-treatment-service-${index + 1}` },
      create: {
        id: `${DEMO}-treatment-service-${index + 1}`,
        organizationId,
        clinicId,
        patientId: spec.patient.id,
        treatmentPlanId: plan.id,
        serviceCatalogItemId: spec.service?.id,
        createdById: dentist.id,
        serviceCode: spec.service?.code ?? `AI-SVC-${index + 1}`,
        serviceName: spec.service?.name ?? spec.title,
        targetSummary: spec.teeth.join(", "),
        teeth: spec.teeth,
        status: spec.status,
        finalPrice: spec.price,
        currentProgressPercent: spec.progress,
        currentStepSequence: Number(spec.progress) >= 50 ? 2 : Number(spec.progress) > 0 ? 1 : null,
      },
      update: {
        organizationId,
        clinicId,
        patientId: spec.patient.id,
        treatmentPlanId: plan.id,
        serviceCatalogItemId: spec.service?.id,
        createdById: dentist.id,
        serviceCode: spec.service?.code ?? `AI-SVC-${index + 1}`,
        serviceName: spec.service?.name ?? spec.title,
        targetSummary: spec.teeth.join(", "),
        teeth: spec.teeth,
        status: spec.status,
        finalPrice: spec.price,
        currentProgressPercent: spec.progress,
        currentStepSequence: Number(spec.progress) >= 50 ? 2 : Number(spec.progress) > 0 ? 1 : null,
      },
    });

    if (Number(spec.progress) > 0) {
      const progressEvent = await prisma.treatmentServiceProgressEvent.upsert({
        where: { id: `${DEMO}-progress-event-${index + 1}` },
        create: {
          id: `${DEMO}-progress-event-${index + 1}`,
          organizationId,
          clinicId,
          treatmentServiceId: treatmentService.id,
          performedById: dentist.id,
          clinicalSupportId: assistant?.id,
          fromProgressPercent: "0.00",
          toProgressPercent: spec.progress,
          progressDeltaPercent: spec.progress,
          fromStepSequence: null,
          toStepSequence: Number(spec.progress) >= 50 ? 2 : 1,
          note: "Tiến độ demo để AI phân tích lâm sàng, vật tư và hoa hồng.",
          occurredAt: addDays(-1),
        },
        update: {
          organizationId,
          clinicId,
          treatmentServiceId: treatmentService.id,
          performedById: dentist.id,
          clinicalSupportId: assistant?.id,
          fromProgressPercent: "0.00",
          toProgressPercent: spec.progress,
          progressDeltaPercent: spec.progress,
          toStepSequence: Number(spec.progress) >= 50 ? 2 : 1,
          note: "Tiến độ demo để AI phân tích lâm sàng, vật tư và hoa hồng.",
          occurredAt: addDays(-1),
        },
      });

      const accrualAmount = Math.round(Number(spec.price) * (Number(spec.progress) / 100) * 0.1);
      const accrual = await prisma.compensationAccrual.upsert({
        where: { progressEventId: progressEvent.id },
        create: {
          id: `${DEMO}-accrual-${index + 1}`,
          organizationId,
          clinicId,
          treatmentServiceId: treatmentService.id,
          progressEventId: progressEvent.id,
          ruleCode: "AI-DEMO-POOL",
          ruleName: "Pool hoa hồng demo",
          ruleVersion: "1",
          ruleSnapshot: { source: DEMO, doctorPoolPercent: 8, assistantPoolPercent: 2 },
          status: "EARNED",
          serviceAmount: spec.price,
          earnedProgressPercent: spec.progress,
          doctorPoolAmount: String(Math.round(accrualAmount * 0.8)),
          assistantPoolAmount: String(Math.round(accrualAmount * 0.2)),
          totalAmount: String(accrualAmount),
        },
        update: {
          organizationId,
          clinicId,
          treatmentServiceId: treatmentService.id,
          ruleSnapshot: { source: DEMO, doctorPoolPercent: 8, assistantPoolPercent: 2 },
          status: "EARNED",
          serviceAmount: spec.price,
          earnedProgressPercent: spec.progress,
          doctorPoolAmount: String(Math.round(accrualAmount * 0.8)),
          assistantPoolAmount: String(Math.round(accrualAmount * 0.2)),
          totalAmount: String(accrualAmount),
        },
      });

      await prisma.compensationAccrualLine.upsert({
        where: { id: `${DEMO}-accrual-line-doctor-${index + 1}` },
        create: {
          id: `${DEMO}-accrual-line-doctor-${index + 1}`,
          organizationId,
          clinicId,
          accrualId: accrual.id,
          userId: dentist.id,
          pool: "DOCTOR",
          role: "OPERATOR",
          sharePercent: "100.00",
          amount: String(Math.round(accrualAmount * 0.8)),
          note: "Hoa hồng demo bác sĩ.",
        },
        update: {
          userId: dentist.id,
          amount: String(Math.round(accrualAmount * 0.8)),
          note: "Hoa hồng demo bác sĩ.",
        },
      });

      if (assistant) {
        await prisma.compensationAccrualLine.upsert({
          where: { id: `${DEMO}-accrual-line-assistant-${index + 1}` },
          create: {
            id: `${DEMO}-accrual-line-assistant-${index + 1}`,
            organizationId,
            clinicId,
            accrualId: accrual.id,
            userId: assistant.id,
            pool: "ASSISTANT",
            role: "ASSISTANT_PRIMARY",
            sharePercent: "100.00",
            amount: String(Math.round(accrualAmount * 0.2)),
            note: "Hoa hồng demo phụ tá.",
          },
          update: {
            userId: assistant.id,
            amount: String(Math.round(accrualAmount * 0.2)),
            note: "Hoa hồng demo phụ tá.",
          },
        });
      }
    }

    await seedBillingForService(organizationId, clinicId, frontdesk.id, spec.patient.id, treatmentService, spec, index);
  }

  await prisma.journeyComment.upsert({
    where: { id: `${DEMO}-journey-comment-1` },
    create: {
      id: `${DEMO}-journey-comment-1`,
      organizationId,
      clinicId,
      patientId: patients[0].id,
      authorId: frontdesk.id,
      body: "Bệnh nhân hỏi trước về chi phí phát sinh nếu phải điều trị tủy. Cần bác sĩ xác nhận sau phim.",
    },
    update: {
      organizationId,
      clinicId,
      patientId: patients[0].id,
      authorId: frontdesk.id,
      body: "Bệnh nhân hỏi trước về chi phí phát sinh nếu phải điều trị tủy. Cần bác sĩ xác nhận sau phim.",
    },
  });

  await prisma.patientFile.upsert({
    where: { id: `${DEMO}-patient-file-1` },
    create: {
      id: `${DEMO}-patient-file-1`,
      organizationId,
      clinicId,
      patientId: patients[1].id,
      uploadedById: dentist.id,
      category: "RADIOGRAPH",
      title: "Phim CT implant 36 demo",
      fileName: "ai-demo-ct-36.pdf",
      mimeType: "application/pdf",
      url: "https://example.com/ai-demo-ct-36.pdf",
      sizeBytes: 524288,
      sourceType: "AI_DEMO",
      notes: "File demo để AI nhận diện hồ sơ thiếu/chờ đọc phim.",
      virusScanStatus: "NOT_SCANNED",
    },
    update: {
      organizationId,
      clinicId,
      patientId: patients[1].id,
      uploadedById: dentist.id,
      title: "Phim CT implant 36 demo",
      url: "https://example.com/ai-demo-ct-36.pdf",
      notes: "File demo để AI nhận diện hồ sơ thiếu/chờ đọc phim.",
    },
  });
}

async function seedBillingForService(organizationId, clinicId, actorId, patientId, treatmentService, spec, index) {
  const collected = Number(spec.collected);
  if (collected <= 0) {
    return;
  }

  const receipt = await prisma.receipt.upsert({
    where: {
      organizationId_receiptNo: {
        organizationId,
        receiptNo: `AI-DEMO-REC-${index + 1}`,
      },
    },
    create: {
      id: `${DEMO}-receipt-${index + 1}`,
      organizationId,
      clinicId,
      patientId,
      receiptNo: `AI-DEMO-REC-${index + 1}`,
      amount: String(collected),
      allocatedAmount: String(Math.min(collected, Number(spec.price))),
      unallocatedAmount: String(Math.max(collected - Number(spec.price), 0)),
      method: index === 1 ? "BANK_TRANSFER" : "CASH",
      reference: `AI-DEMO-${index + 1}`,
      note: "Phiếu thu demo AI theo dịch vụ Journey.",
      receivedAt: addDays(-index),
    },
    update: {
      clinicId,
      patientId,
      amount: String(collected),
      allocatedAmount: String(Math.min(collected, Number(spec.price))),
      unallocatedAmount: String(Math.max(collected - Number(spec.price), 0)),
      method: index === 1 ? "BANK_TRANSFER" : "CASH",
      note: "Phiếu thu demo AI theo dịch vụ Journey.",
      receivedAt: addDays(-index),
    },
  });

  const invoiceAmount = index === 1 ? 0 : Math.min(collected, Number(spec.price));
  let invoice = null;
  let invoiceItem = null;
  if (invoiceAmount > 0) {
    invoice = await prisma.invoice.upsert({
      where: {
        organizationId_invoiceNo: {
          organizationId,
          invoiceNo: `AI-DEMO-INV-${index + 1}`,
        },
      },
      create: {
        id: `${DEMO}-invoice-${index + 1}`,
        organizationId,
        clinicId,
        patientId,
        invoiceNo: `AI-DEMO-INV-${index + 1}`,
        status: invoiceAmount >= Number(spec.price) ? "PAID" : "PARTIAL",
        amount: String(invoiceAmount),
        paidAmount: String(invoiceAmount),
        dueDate: addDays(index === 2 ? -2 : 7),
      },
      update: {
        clinicId,
        patientId,
        status: invoiceAmount >= Number(spec.price) ? "PAID" : "PARTIAL",
        amount: String(invoiceAmount),
        paidAmount: String(invoiceAmount),
        dueDate: addDays(index === 2 ? -2 : 7),
      },
    });

    invoiceItem = await prisma.invoiceItem.upsert({
      where: { id: `${DEMO}-invoice-item-${index + 1}` },
      create: {
        id: `${DEMO}-invoice-item-${index + 1}`,
        organizationId,
        clinicId,
        patientId,
        invoiceId: invoice.id,
        treatmentServiceId: treatmentService.id,
        description: `${treatmentService.serviceName} - hóa đơn demo lần này`,
        quantity: "1.00",
        unitPrice: String(invoiceAmount),
        amount: String(invoiceAmount),
      },
      update: {
        clinicId,
        patientId,
        invoiceId: invoice.id,
        treatmentServiceId: treatmentService.id,
        description: `${treatmentService.serviceName} - hóa đơn demo lần này`,
        unitPrice: String(invoiceAmount),
        amount: String(invoiceAmount),
      },
    });

    await prisma.payment.upsert({
      where: { id: `${DEMO}-payment-${index + 1}` },
      create: {
        id: `${DEMO}-payment-${index + 1}`,
        invoiceId: invoice.id,
        amount: String(invoiceAmount),
        method: receipt.method,
        reference: receipt.receiptNo,
        paidAt: receipt.receivedAt,
      },
      update: {
        invoiceId: invoice.id,
        amount: String(invoiceAmount),
        method: receipt.method,
        reference: receipt.receiptNo,
        paidAt: receipt.receivedAt,
      },
    });
  }

  await prisma.receiptAllocation.upsert({
    where: { id: `${DEMO}-receipt-allocation-${index + 1}` },
    create: {
      id: `${DEMO}-receipt-allocation-${index + 1}`,
      organizationId,
      clinicId,
      patientId,
      receiptId: receipt.id,
      invoiceId: invoice?.id,
      invoiceItemId: invoiceItem?.id,
      treatmentServiceId: treatmentService.id,
      amount: String(Math.min(collected, Number(spec.price))),
      note: "Phân bổ thu demo vào dịch vụ Journey.",
    },
    update: {
      clinicId,
      patientId,
      receiptId: receipt.id,
      invoiceId: invoice?.id,
      invoiceItemId: invoiceItem?.id,
      treatmentServiceId: treatmentService.id,
      amount: String(Math.min(collected, Number(spec.price))),
      note: "Phân bổ thu demo vào dịch vụ Journey.",
    },
  });

  if (index === 1) {
    await prisma.patientCreditBalance.upsert({
      where: { patientId },
      create: {
        id: `${DEMO}-credit-${index + 1}`,
        organizationId,
        clinicId,
        patientId,
        amount: "500000",
      },
      update: { organizationId, clinicId, amount: "500000" },
    });
  }
}

async function seedCrm(organizationId, clinicId, actorId, patients) {
  const leads = [
    {
      id: `${DEMO}-lead-1`,
      patient: patients[4],
      status: "CONSULT_BOOKED",
      source: "TELESALE",
      campaignName: "Thẩm mỹ răng sứ tháng này",
      nextFollowUpAt: dateAt(15, 30, 0),
      note: "Khách quan tâm trả góp, cần bác sĩ tư vấn vật liệu phù hợp thuốc chống đông.",
    },
    {
      id: `${DEMO}-lead-2`,
      patient: null,
      name: "Khách Facebook - Lan Chi",
      phone: "0909000199",
      email: "lanchi.ai.demo@example.com",
      status: "NEW",
      source: "ADS_FACEBOOK",
      campaignName: "Lead niềng răng sinh viên",
      nextFollowUpAt: dateAt(9, 30, -1),
      note: "Lead quá hạn gọi lại, chưa đặt lịch.",
    },
    {
      id: `${DEMO}-lead-3`,
      patient: patients[3],
      status: "RECALL",
      source: "AUTO_RECALL",
      campaignName: "Tái khám trẻ em",
      nextFollowUpAt: dateAt(10, 0, 1),
      note: "No-show hôm qua, cần gọi phụ huynh xác nhận lịch mới.",
    },
  ];

  for (const [index, lead] of leads.entries()) {
    const savedLead = await prisma.crmLead.upsert({
      where: { id: lead.id },
      create: {
        id: lead.id,
        organizationId,
        clinicId,
        patientId: lead.patient?.id,
        ownerId: actorId,
        status: lead.status,
        source: lead.source,
        name: lead.patient?.fullName ?? lead.name,
        phone: lead.patient?.phone ?? lead.phone,
        email: lead.patient?.email ?? lead.email,
        campaignName: lead.campaignName,
        nextFollowUpAt: lead.nextFollowUpAt,
        note: lead.note,
      },
      update: {
        clinicId,
        patientId: lead.patient?.id,
        ownerId: actorId,
        status: lead.status,
        source: lead.source,
        name: lead.patient?.fullName ?? lead.name,
        phone: lead.patient?.phone ?? lead.phone,
        email: lead.patient?.email ?? lead.email,
        campaignName: lead.campaignName,
        nextFollowUpAt: lead.nextFollowUpAt,
        note: lead.note,
      },
    });

    await prisma.crmActivity.upsert({
      where: { id: `${DEMO}-crm-activity-${index + 1}` },
      create: {
        id: `${DEMO}-crm-activity-${index + 1}`,
        organizationId,
        clinicId,
        patientId: lead.patient?.id,
        leadId: savedLead.id,
        actorId,
        type: index === 1 ? "CALL" : "FOLLOW_UP",
        channel: index === 1 ? "PHONE" : "ZALO",
        subject: index === 1 ? "Gọi lại lead quá hạn" : "Nhắc lịch/tư vấn demo",
        body: lead.note,
        dueAt: lead.nextFollowUpAt,
        completedAt: index === 0 ? addDays(-1) : null,
        metadata: { source: DEMO, risk: index === 1 ? "overdue" : "normal" },
      },
      update: {
        clinicId,
        patientId: lead.patient?.id,
        leadId: savedLead.id,
        actorId,
        type: index === 1 ? "CALL" : "FOLLOW_UP",
        channel: index === 1 ? "PHONE" : "ZALO",
        subject: index === 1 ? "Gọi lại lead quá hạn" : "Nhắc lịch/tư vấn demo",
        body: lead.note,
        dueAt: lead.nextFollowUpAt,
        completedAt: index === 0 ? addDays(-1) : null,
        metadata: { source: DEMO, risk: index === 1 ? "overdue" : "normal" },
      },
    });
  }
}

async function seedInventory(organizationId, clinicId, actorId) {
  const supplier = await prisma.inventorySupplier.upsert({
    where: { organizationId_code: { organizationId, code: "AI-DEMO-SUP" } },
    create: {
      id: `${DEMO}-supplier`,
      organizationId,
      code: "AI-DEMO-SUP",
      name: "Nhà cung cấp vật tư demo AI",
      taxCode: "AI-DEMO-TAX",
      phone: "0909000200",
      email: "supplier.ai.demo@example.com",
      address: "Kho demo Bắc Ninh",
      active: true,
    },
    update: {
      name: "Nhà cung cấp vật tư demo AI",
      phone: "0909000200",
      email: "supplier.ai.demo@example.com",
      active: true,
    },
  });

  const itemSpecs = [
    {
      id: `${DEMO}-inventory-composite`,
      code: "AI-COMP-A2",
      name: "Composite A2",
      category: "Vật liệu trám",
      unit: "ống",
      minimumStock: "10.00",
      onHandQuantity: "6.00",
      averageUnitCost: "280000",
      lotTracked: true,
    },
    {
      id: `${DEMO}-inventory-glove`,
      code: "AI-GLOVE-M",
      name: "Găng tay size M",
      category: "Tiêu hao",
      unit: "hộp",
      minimumStock: "20.00",
      onHandQuantity: "24.00",
      averageUnitCost: "85000",
      lotTracked: false,
    },
    {
      id: `${DEMO}-inventory-implant-kit`,
      code: "AI-IMPLANT-KIT",
      name: "Bộ kit implant",
      category: "Implant",
      unit: "bộ",
      minimumStock: "3.00",
      onHandQuantity: "2.00",
      averageUnitCost: "4200000",
      lotTracked: true,
    },
  ];

  const items = [];
  for (const item of itemSpecs) {
    const isLowStock = Number(item.onHandQuantity) < Number(item.minimumStock);
    const savedItem = await prisma.inventoryItem.upsert({
      where: { organizationId_code: { organizationId, code: item.code } },
      create: {
        ...item,
        organizationId,
        clinicId,
        supplierId: supplier.id,
        active: true,
      },
      update: {
        clinicId,
        supplierId: supplier.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        minimumStock: item.minimumStock,
        onHandQuantity: item.onHandQuantity,
        averageUnitCost: item.averageUnitCost,
        lotTracked: item.lotTracked,
        active: true,
      },
    });
    items.push(savedItem);

    await prisma.inventoryMovement.upsert({
      where: { id: `${item.id}-movement` },
      create: {
        id: `${item.id}-movement`,
        organizationId,
        clinicId,
        itemId: savedItem.id,
        performedById: actorId,
        type: isLowStock ? "CONSUMPTION" : "PURCHASE",
        quantity: isLowStock ? "-4.00" : "24.00",
        unitCost: item.averageUnitCost,
        referenceType: "AI_DEMO_SEED",
        referenceId: item.id,
        note: isLowStock ? "Demo tồn kho thấp để AI cảnh báo đặt hàng." : "Demo nhập kho.",
      },
      update: {
        clinicId,
        itemId: savedItem.id,
        performedById: actorId,
        type: isLowStock ? "CONSUMPTION" : "PURCHASE",
        quantity: isLowStock ? "-4.00" : "24.00",
        unitCost: item.averageUnitCost,
        note: isLowStock ? "Demo tồn kho thấp để AI cảnh báo đặt hàng." : "Demo nhập kho.",
      },
    });

    if (item.lotTracked) {
      await prisma.inventoryLot.upsert({
        where: { itemId_lotNo: { itemId: savedItem.id, lotNo: `${item.code}-LOT-AI` } },
        create: {
          id: `${item.id}-lot`,
          organizationId,
          clinicId,
          itemId: savedItem.id,
          lotNo: `${item.code}-LOT-AI`,
          expiresAt: addDays(item.code === "AI-COMP-A2" ? 25 : 180),
          quantityOnHand: item.onHandQuantity,
        },
        update: {
          clinicId,
          expiresAt: addDays(item.code === "AI-COMP-A2" ? 25 : 180),
          quantityOnHand: item.onHandQuantity,
        },
      });
    }
  }

  const po = await prisma.purchaseOrder.upsert({
    where: { organizationId_poNo: { organizationId, poNo: "AI-DEMO-PO-001" } },
    create: {
      id: `${DEMO}-purchase-order-1`,
      organizationId,
      clinicId,
      supplierId: supplier.id,
      poNo: "AI-DEMO-PO-001",
      status: "PARTIAL",
      orderedAt: addDays(-2),
      expectedAt: addDays(3),
      totalAmount: "11200000",
    },
    update: {
      clinicId,
      supplierId: supplier.id,
      status: "PARTIAL",
      orderedAt: addDays(-2),
      expectedAt: addDays(3),
      totalAmount: "11200000",
    },
  });

  for (const [index, item] of items.entries()) {
    await prisma.purchaseOrderLine.upsert({
      where: { purchaseOrderId_itemId: { purchaseOrderId: po.id, itemId: item.id } },
      create: {
        id: `${DEMO}-po-line-${index + 1}`,
        purchaseOrderId: po.id,
        itemId: item.id,
        quantity: index === 1 ? "10.00" : "4.00",
        unitCost: item.averageUnitCost ?? "100000",
        receivedQuantity: index === 1 ? "10.00" : "1.00",
      },
      update: {
        quantity: index === 1 ? "10.00" : "4.00",
        unitCost: item.averageUnitCost ?? "100000",
        receivedQuantity: index === 1 ? "10.00" : "1.00",
      },
    });
  }

  return items;
}

async function seedPharmacyFormsLearning(organizationId, clinicId, actorId, patients, users) {
  const dentist = users.find((item) => item.user.role === "DENTIST")?.user ?? { id: actorId };

  const meds = [
    {
      id: `${DEMO}-med-paracetamol`,
      code: "AI-PARA-500",
      genericName: "Paracetamol",
      brandName: "Demo Para 500",
      strength: "500mg",
      form: "Viên",
      defaultSig: "Uống khi đau, tối đa theo hướng dẫn bác sĩ.",
      defaultDose: "1 viên",
      route: "PO",
      frequency: "Mỗi 6-8 giờ nếu cần",
      warnings: ["Không dùng quá liều", "Kiểm tra bệnh gan"],
    },
    {
      id: `${DEMO}-med-ibuprofen`,
      code: "AI-IBU-400",
      genericName: "Ibuprofen",
      brandName: "Demo Ibu 400",
      strength: "400mg",
      form: "Viên",
      defaultSig: "Uống sau ăn nếu cần giảm đau.",
      defaultDose: "1 viên",
      route: "PO",
      frequency: "Mỗi 8 giờ nếu cần",
      warnings: ["Thận trọng dạ dày", "Thận trọng thuốc chống đông"],
    },
  ];

  const savedMeds = [];
  for (const med of meds) {
    savedMeds.push(
      await prisma.medicationCatalogItem.upsert({
        where: { organizationId_code: { organizationId, code: med.code } },
        create: { ...med, organizationId, active: true },
        update: {
          genericName: med.genericName,
          brandName: med.brandName,
          strength: med.strength,
          form: med.form,
          defaultSig: med.defaultSig,
          defaultDose: med.defaultDose,
          route: med.route,
          frequency: med.frequency,
          warnings: med.warnings,
          active: true,
        },
      }),
    );
  }

  const prescription = await prisma.prescription.upsert({
    where: { prescriptionNo: "AI-DEMO-RX-001" },
    create: {
      id: `${DEMO}-prescription-1`,
      organizationId,
      clinicId,
      patientId: patients[0].id,
      prescriberId: dentist.id,
      prescriptionNo: "AI-DEMO-RX-001",
      status: "SIGNED",
      diagnosis: "Đau răng 46, chờ xử trí nguyên nhân.",
      notes: "Demo để AI nhắc kiểm tra dị ứng Penicillin và tránh tư vấn thuốc thay bác sĩ.",
      signedAt: addDays(-1),
    },
    update: {
      clinicId,
      patientId: patients[0].id,
      prescriberId: dentist.id,
      status: "SIGNED",
      diagnosis: "Đau răng 46, chờ xử trí nguyên nhân.",
      notes: "Demo để AI nhắc kiểm tra dị ứng Penicillin và tránh tư vấn thuốc thay bác sĩ.",
      signedAt: addDays(-1),
    },
  });

  for (const [index, med] of savedMeds.entries()) {
    await prisma.prescriptionItem.upsert({
      where: { id: `${DEMO}-prescription-item-${index + 1}` },
      create: {
        id: `${DEMO}-prescription-item-${index + 1}`,
        prescriptionId: prescription.id,
        medicationId: med.id,
        drugName: med.genericName,
        strength: med.strength,
        sig: med.defaultSig ?? "Theo hướng dẫn bác sĩ.",
        quantity: index === 0 ? "10 viên" : "6 viên",
        refills: 0,
        durationDays: 3,
        instructions: med.warnings.join("; "),
      },
      update: {
        prescriptionId: prescription.id,
        medicationId: med.id,
        drugName: med.genericName,
        strength: med.strength,
        sig: med.defaultSig ?? "Theo hướng dẫn bác sĩ.",
        quantity: index === 0 ? "10 viên" : "6 viên",
        durationDays: 3,
        instructions: med.warnings.join("; "),
      },
    });
  }

  const template = await prisma.formTemplate.upsert({
    where: { organizationId_code_version: { organizationId, code: "AI-DEMO-CONSENT", version: "1" } },
    create: {
      id: `${DEMO}-form-template-1`,
      organizationId,
      clinicId,
      createdById: actorId,
      type: "CONSENT",
      code: "AI-DEMO-CONSENT",
      name: "Cam kết điều trị demo AI",
      version: "1",
      schema: {
        fields: [
          { key: "medicalHistory", label: "Bệnh sử", type: "textarea" },
          { key: "financialConsent", label: "Đồng ý chi phí", type: "checkbox" },
        ],
      },
      body: "Mẫu demo để AI rà soát form đã gửi/chưa hoàn tất.",
      requiresSignature: true,
      active: true,
    },
    update: {
      clinicId,
      name: "Cam kết điều trị demo AI",
      schema: {
        fields: [
          { key: "medicalHistory", label: "Bệnh sử", type: "textarea" },
          { key: "financialConsent", label: "Đồng ý chi phí", type: "checkbox" },
        ],
      },
      body: "Mẫu demo để AI rà soát form đã gửi/chưa hoàn tất.",
      requiresSignature: true,
      active: true,
    },
  });

  const formSpecs = [
    { patient: patients[1], status: "SENT", sentAt: addDays(-1), completedAt: null, expiresAt: addDays(2) },
    { patient: patients[2], status: "COMPLETED", sentAt: addDays(-3), completedAt: addDays(-2), expiresAt: addDays(30) },
    { patient: patients[4], status: "EXPIRED", sentAt: addDays(-14), completedAt: null, expiresAt: addDays(-1) },
  ];
  for (const [index, form] of formSpecs.entries()) {
    await prisma.patientForm.upsert({
      where: { formNo: `AI-DEMO-FORM-${index + 1}` },
      create: {
        id: `${DEMO}-patient-form-${index + 1}`,
        organizationId,
        clinicId,
        patientId: form.patient.id,
        templateId: template.id,
        requestedById: actorId,
        formNo: `AI-DEMO-FORM-${index + 1}`,
        status: form.status,
        responses:
          form.status === "COMPLETED"
            ? { medicalHistory: "Không dị ứng thuốc theo khai báo.", financialConsent: true, source: DEMO }
            : null,
        signatureUrl: form.status === "COMPLETED" ? "https://example.com/ai-demo-signature.png" : null,
        attachments: form.status === "COMPLETED" ? ["ai-demo-attachment.pdf"] : [],
        sentAt: form.sentAt,
        completedAt: form.completedAt,
        expiresAt: form.expiresAt,
      },
      update: {
        clinicId,
        patientId: form.patient.id,
        templateId: template.id,
        requestedById: actorId,
        status: form.status,
        responses:
          form.status === "COMPLETED"
            ? { medicalHistory: "Không dị ứng thuốc theo khai báo.", financialConsent: true, source: DEMO }
            : null,
        signatureUrl: form.status === "COMPLETED" ? "https://example.com/ai-demo-signature.png" : null,
        attachments: form.status === "COMPLETED" ? ["ai-demo-attachment.pdf"] : [],
        sentAt: form.sentAt,
        completedAt: form.completedAt,
        expiresAt: form.expiresAt,
      },
    });
  }

  const content = await prisma.learningContent.upsert({
    where: { organizationId_code: { organizationId, code: "AI-DEMO-LEARN-01" } },
    create: {
      id: `${DEMO}-learning-content-1`,
      organizationId,
      clinicId,
      authorId: actorId,
      code: "AI-DEMO-LEARN-01",
      type: "CHECKLIST",
      title: "Checklist tư vấn chi phí và cam kết điều trị",
      summary: "Nội dung demo để AI gợi ý nhân sự cần hoàn tất đào tạo.",
      body: "1. Xác nhận nguồn khách. 2. Gửi form. 3. Giải thích đặt cọc/hóa đơn. 4. Ghi chú rủi ro y khoa.",
      durationMinutes: 25,
      publishedAt: addDays(-10),
      active: true,
    },
    update: {
      clinicId,
      authorId: actorId,
      type: "CHECKLIST",
      title: "Checklist tư vấn chi phí và cam kết điều trị",
      summary: "Nội dung demo để AI gợi ý nhân sự cần hoàn tất đào tạo.",
      body: "1. Xác nhận nguồn khách. 2. Gửi form. 3. Giải thích đặt cọc/hóa đơn. 4. Ghi chú rủi ro y khoa.",
      durationMinutes: 25,
      publishedAt: addDays(-10),
      active: true,
    },
  });

  for (const [index, staffUser] of users.map((item) => item.user).slice(0, 4).entries()) {
    await prisma.learningEnrollment.upsert({
      where: { contentId_userId: { contentId: content.id, userId: staffUser.id } },
      create: {
        id: `${DEMO}-learning-enrollment-${index + 1}`,
        organizationId,
        clinicId,
        contentId: content.id,
        userId: staffUser.id,
        assignedById: actorId,
        status: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "ASSIGNED"][index] ?? "ASSIGNED",
        assignedAt: addDays(-7),
        startedAt: index >= 1 ? addDays(-5) : null,
        completedAt: index === 2 ? addDays(-2) : null,
        score: index === 2 ? "92.00" : null,
      },
      update: {
        clinicId,
        assignedById: actorId,
        status: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "ASSIGNED"][index] ?? "ASSIGNED",
        assignedAt: addDays(-7),
        startedAt: index >= 1 ? addDays(-5) : null,
        completedAt: index === 2 ? addDays(-2) : null,
        score: index === 2 ? "92.00" : null,
      },
    });
  }
}

async function seedDashboardCommunityNotifications(organizationId, clinicId, actorId, patients) {
  const items = [
    {
      id: `${DEMO}-workitem-overdue-invoice`,
      patientId: patients[2].id,
      priority: "high",
      title: "Theo dõi công nợ chỉnh nha demo",
      detail: "Bệnh nhân đã thu 8 triệu, còn lộ trình thanh toán lớn cần kế hoạch nhắc lịch.",
      dueAt: dateAt(9, 0, -1),
    },
    {
      id: `${DEMO}-workitem-low-stock`,
      patientId: null,
      priority: "medium",
      title: "Kiểm tra tồn kho composite và implant kit",
      detail: "Hai vật tư đang dưới định mức, PO demo mới nhận một phần.",
      dueAt: dateAt(12, 0, 0),
    },
    {
      id: `${DEMO}-workitem-form-expired`,
      patientId: patients[4].id,
      priority: "medium",
      title: "Gửi lại form cam kết bọc sứ",
      detail: "Form demo đã hết hạn trước buổi tư vấn thẩm mỹ.",
      dueAt: dateAt(11, 30, 1),
    },
  ];

  for (const item of items) {
    await prisma.workItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        organizationId,
        clinicId,
        patientId: item.patientId,
        assignedToId: actorId,
        createdById: actorId,
        sourceKind: "AI_DEMO",
        sourceId: item.id,
        priority: item.priority,
        status: "OPEN",
        title: item.title,
        detail: item.detail,
        dueAt: item.dueAt,
      },
      update: {
        clinicId,
        patientId: item.patientId,
        assignedToId: actorId,
        priority: item.priority,
        status: "OPEN",
        title: item.title,
        detail: item.detail,
        dueAt: item.dueAt,
      },
    });
  }

  await prisma.notification.upsert({
    where: { id: `${DEMO}-notification-failed` },
    create: {
      id: `${DEMO}-notification-failed`,
      organizationId,
      clinicId,
      patientId: patients[3].id,
      userId: actorId,
      channel: "ZALO",
      status: "FAILED",
      templateKey: "AI_DEMO_RECALL",
      recipient: patients[3].phone,
      subject: "Nhắc tái khám demo",
      body: "Tin nhắn demo thất bại để Dashboard/AI cảnh báo cần gửi lại.",
      scheduledAt: dateAt(8, 0, -1),
      failedReason: "Webhook demo không phản hồi.",
      metadata: { source: DEMO },
    },
    update: {
      clinicId,
      patientId: patients[3].id,
      userId: actorId,
      status: "FAILED",
      recipient: patients[3].phone,
      body: "Tin nhắn demo thất bại để Dashboard/AI cảnh báo cần gửi lại.",
      scheduledAt: dateAt(8, 0, -1),
      failedReason: "Webhook demo không phản hồi.",
      metadata: { source: DEMO },
    },
  });

  const post = await prisma.communityPost.upsert({
    where: { id: `${DEMO}-community-post-1` },
    create: {
      id: `${DEMO}-community-post-1`,
      organizationId,
      clinicId,
      authorId: actorId,
      type: "SHIFT_HANDOFF",
      title: "Bàn giao ca demo AI: implant và tồn kho",
      body: "Ca chiều có tư vấn implant 36, cần kiểm tra CT/HbA1c và bộ kit implant đang dưới định mức.",
      tags: ["ai-demo", "implant", "inventory"],
    },
    update: {
      clinicId,
      authorId: actorId,
      type: "SHIFT_HANDOFF",
      title: "Bàn giao ca demo AI: implant và tồn kho",
      body: "Ca chiều có tư vấn implant 36, cần kiểm tra CT/HbA1c và bộ kit implant đang dưới định mức.",
      tags: ["ai-demo", "implant", "inventory"],
    },
  });

  await prisma.postComment.upsert({
    where: { id: `${DEMO}-community-comment-1` },
    create: {
      id: `${DEMO}-community-comment-1`,
      postId: post.id,
      authorId: actorId,
      body: "Đã thêm vào danh sách việc cần AI phân tích trước buổi chiều.",
    },
    update: {
      postId: post.id,
      authorId: actorId,
      body: "Đã thêm vào danh sách việc cần AI phân tích trước buổi chiều.",
    },
  });
}

async function main() {
  const { organization, clinic, actor } = await ensureBase();
  const chairs = await seedChairs(clinic.id);
  const staffUsers = await seedUsersAndStaff(organization.id, clinic.id, actor.id);
  const patients = await seedPatients(organization.id, clinic.id);
  const services = await seedServices(organization.id, clinic.id);

  await seedClinicalJourney(organization.id, clinic.id, actor.id, patients, staffUsers, services, chairs);
  await seedCrm(organization.id, clinic.id, actor.id, patients);
  await seedInventory(organization.id, clinic.id, actor.id);
  await seedPharmacyFormsLearning(organization.id, clinic.id, actor.id, patients, staffUsers);
  await seedDashboardCommunityNotifications(organization.id, clinic.id, actor.id, patients);

  const counts = await Promise.all([
    prisma.patient.count({ where: { id: { startsWith: DEMO } } }),
    prisma.appointment.count({ where: { source: "ai_demo" } }),
    prisma.treatmentService.count({ where: { id: { startsWith: DEMO } } }),
    prisma.receipt.count({ where: { receiptNo: { startsWith: "AI-DEMO" } } }),
    prisma.invoice.count({ where: { invoiceNo: { startsWith: "AI-DEMO" } } }),
    prisma.crmLead.count({ where: { id: { startsWith: DEMO } } }),
    prisma.inventoryItem.count({ where: { code: { startsWith: "AI-" } } }),
    prisma.prescription.count({ where: { prescriptionNo: { startsWith: "AI-DEMO" } } }),
    prisma.patientForm.count({ where: { formNo: { startsWith: "AI-DEMO" } } }),
    prisma.learningContent.count({ where: { code: { startsWith: "AI-DEMO" } } }),
    prisma.workItem.count({ where: { sourceKind: { startsWith: "AI_DEMO" } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        organization: organization.name,
        clinic: clinic.name,
        actor: actor.email,
        counts: {
          patients: counts[0],
          appointments: counts[1],
          treatmentServices: counts[2],
          receipts: counts[3],
          invoices: counts[4],
          crmLeads: counts[5],
          inventoryItems: counts[6],
          prescriptions: counts[7],
          patientForms: counts[8],
          learningContents: counts[9],
          workItems: counts[10],
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

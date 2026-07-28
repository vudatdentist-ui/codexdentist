"use client";

import {
  Activity,
  Archive,
  Bell,
  Building2,
  CheckCircle2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  createChairAction,
  createClinicAction,
  createOrganizationAction,
  createSourceCommissionPolicyAction,
  createStaffPasswordSetupLinkAction,
  createStaffAction,
  generateSourceCommissionAccrualsAction,
  sendNotificationTestAction,
  toggleClinicStatusAction,
  toggleChairStatusAction,
  toggleSourceCommissionPolicyAction,
  toggleStaffStatusAction,
  updateSourceCommissionAccrualStatusAction,
  updateClinicAction,
  updateChairAction,
  updateStaffProfileAction,
  updateStaffRoleAction,
} from "@/app/(app)/settings/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import {
  EmptyState,
  MetricCard,
  PanelHeader,
  RecordTile,
  StatusPill as BaseStatusPill,
} from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { roleLabels, type AppRole } from "@/lib/permissions";
import type { SettingsWorkspace } from "@/lib/settings-types";

const settingsText = {
  vi: {
      access: "Quyền truy cập",
      activate: "Kích hoạt",
      active: "Đang hoạt động",
      admin: "Quản trị",
      auditTrail: "Audit trail",
      clinic: "Phòng khám",
      compliance: "Kiểm soát tuân thủ đơn giản",
      complianceItems: [
        "Đã thu đồng ý trước khi xử lý dữ liệu sức khỏe",
        "Audit log lưu thay đổi bệnh nhân, thanh toán, lâm sàng và portal",
        "Yêu cầu xuất/xóa dữ liệu được chuyển cho quản trị phòng khám",
        "Đã hoàn tất rà soát xử lý dữ liệu xuyên biên giới",
      ],
      createStaff: "Tạo nhân sự",
      createStaffAccount: "Tạo tài khoản nhân sự",
      deactivate: "Ngừng kích hoạt",
      city: "Thành phố",
      email: "Email",
      fullName: "Họ tên",
      heading: "Nhân sự, quyền truy cập và kiểm soát tuân thủ",
      inactive: "Ngừng hoạt động",
      noClinic: "Chưa gán phòng khám",
      noStaff: "Không có tài khoản nhân sự trong phạm vi phòng khám này",
      permissions: [
        ["Chủ hệ thống", "Tất cả phòng khám", "Tài chính, nhân sự, xuất dữ liệu, cài đặt"],
        ["Quản lý phòng khám", "Phòng khám được phân quyền", "Lịch hẹn, bệnh nhân, thanh toán, báo cáo"],
        ["Bác sĩ", "Đội điều trị", "Bệnh án, ghi chú, chỉ định, kế hoạch"],
        ["Lễ tân", "Phòng khám được phân quyền", "Đặt lịch, biểu mẫu, nhắc hẹn, thu tiền"],
        ["Bệnh nhân", "Hồ sơ cá nhân", "Lịch hẹn, biểu mẫu, thanh toán, tin nhắn"],
      ],
      readiness: "Sẵn sàng pilot",
      readinessAction: "Theo checklist",
      readinessItems: [
        ["Đã xong", "Route, phân quyền và audit log MVP"],
        ["Đã xong", "In/xuất hóa đơn và luồng thu tiền Journey"],
        ["Cần làm", "Onboarding thật thay cho mật khẩu demo"],
        ["Cần làm", "Thông báo SMS/Zalo/email"],
        ["Cần rà soát", "Dữ liệu cá nhân với tư vấn pháp lý địa phương"],
      ],
      review: "Rà soát",
      role: "Vai trò",
      save: "Lưu",
      scopeSuffix: "phòng khám",
      staffRoles: "Vai trò nhân sự",
    },
  en: {
      access: "Access",
      activate: "Activate",
      active: "Active",
      admin: "Administration",
      auditTrail: "Audit trail",
      clinic: "Clinic",
      compliance: "Simple compliance controls",
      complianceItems: [
        "Consent captured before processing health data",
        "Audit logs stored for patient, billing, clinical, and portal actions",
        "Data export and deletion requests routed to clinic admin",
        "Cross-border processing review completed",
      ],
      createStaff: "Create staff",
      createStaffAccount: "Create staff account",
      deactivate: "Deactivate",
      city: "City",
      email: "Email",
      fullName: "Full name",
      heading: "Staff roles, access, and compliance controls",
      inactive: "Inactive",
      noClinic: "No clinic",
      noStaff: "No staff accounts in this clinic scope",
      permissions: [
        ["Owner", "All clinics", "Finance, staff, data export, settings"],
        ["Clinic manager", "Assigned clinics", "Schedule, patients, billing, reports"],
        ["Dentist", "Care team", "Charting, notes, prescriptions, plans"],
        ["Front desk", "Assigned clinics", "Bookings, forms, reminders, payments"],
        ["Patient", "Own profile", "Appointments, forms, payments, messages"],
      ],
      readiness: "Pilot readiness",
      readinessAction: "Checklist",
      readinessItems: [
        ["Done", "MVP routes, permissions, and audit logs"],
        ["Done", "Invoice print/export and Journey collection flow"],
        ["Needed", "Real onboarding instead of demo passwords"],
        ["Needed", "SMS/Zalo/email notifications"],
        ["Review", "Personal-data handling with local counsel"],
      ],
      review: "Review",
      role: "Role",
      save: "Save",
      scopeSuffix: "clinic scope",
      staffRoles: "Staff roles",
    },
} as const;

const roleText: Record<Language, Record<AppRole, string>> = {
  vi: {
    OWNER: "Chủ hệ thống",
    AREA_MANAGER: "Quản lý khu vực",
    CLINIC_MANAGER: "Quản lý phòng khám",
    DENTIST: "Bác sĩ",
    HYGIENIST: "Điều dưỡng nha khoa",
    FRONT_DESK: "Lễ tân",
    BILLING: "Thu ngân",
    PATIENT: "Bệnh nhân",
  },
  en: roleLabels,
};

const auditTrail = [
  "Dr. Linh opened Nguyen Minh Anh clinical chart",
  "Front desk updated consent for Le Hoang Vy",
  "Billing exported overdue invoice list",
  "Area manager changed chair hours for Da Nang",
];

const sourceLabels: Record<Language, { databaseLive: string; demoMode: string }> = {
  vi: { databaseLive: "", demoMode: "" },
  en: { databaseLive: "", demoMode: "" },
};

const statusText: Record<Language, Record<string, string>> = {
  vi: {
    Active: "Đang hoạt động",
    Inactive: "Ngừng hoạt động",
    ACTIVE: "Đang hoạt động",
    INACTIVE: "Ngừng hoạt động",
    EARNED: "Đã phát sinh",
    APPROVED: "Đã duyệt",
    PAID: "Đã chi trả",
    SUCCEEDED: "Hoàn tất",
    FAILED: "Lỗi gọi",
    PENDING: "Đang chờ",
  },
  en: {},
};

function displayStatus(status: string, language: Language) {
  return statusText[language][status] ?? status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { language } = useAppLanguage();
  const labels = sourceLabels[language];

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? labels.databaseLive : labels.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, _language: Language) {
  return message;
}

const settingsNotices: Record<Language, Record<string, string>> = {
  vi: {
    "settings-chair-created": "Đã thêm ghế điều trị.",
    "settings-chair-updated": "Đã cập nhật ghế điều trị.",
    "settings-chair-activated": "Đã kích hoạt ghế điều trị.",
    "settings-chair-deactivated": "Đã ngừng dùng ghế điều trị.",
    "settings-chair-missing": "Cần nhập tên ghế điều trị.",
    "settings-chair-exists": "Tên ghế này đã tồn tại trong phòng khám.",
    "settings-chair-not-found": "Không tìm thấy ghế điều trị trong phạm vi này.",
    "settings-staff-created": "Đã tạo tài khoản nhân sự và tạo yêu cầu gửi email thiết lập mật khẩu.",
    "settings-password-link-created": "Đã tạo yêu cầu gửi email thiết lập mật khẩu.",
    "settings-role-updated": "Đã cập nhật vai trò nhân sự.",
    "settings-status-updated": "Đã cập nhật trạng thái nhân sự.",
    "settings-profile-updated": "Đã cập nhật hồ sơ nhân sự.",
    "settings-profile-missing-fields": "Cần có họ tên nhân sự.",
    "settings-profile-bad-date": "Chọn ngày hồ sơ nhân sự hợp lệ.",
    "settings-profile-bad-number": "Nhập lương và hoa hồng hợp lệ.",
    "settings-profile-bad-avatar": "Ảnh hồ sơ phải là file ảnh.",
    "settings-profile-avatar-large": "Ảnh hồ sơ phải nhỏ hơn hoặc bằng 5 MB.",
    "settings-profile-code-exists": "Mã nhân sự này đã được hồ sơ khác sử dụng.",
    "settings-denied": "Vai trò này không thể thay đổi cài đặt.",
    "settings-missing": "Cần có tên, email, vai trò và phòng khám.",
    "settings-email-exists": "Email này đã được tài khoản khác sử dụng.",
    "settings-self-password-link":
      "Vì lý do an toàn, chỉ tạo email thiết lập mật khẩu cho tài khoản khác. Hãy dùng trang reset password cho tài khoản của bạn.",
    "settings-clinic-created": "Đã tạo chi nhánh.",
    "settings-clinic-updated": "Đã cập nhật chi nhánh.",
    "settings-clinic-activated": "Đã kích hoạt chi nhánh.",
    "settings-clinic-deactivated": "Đã ngừng hoạt động chi nhánh.",
    "settings-chain-created": "Đã tạo chuỗi phòng khám.",
    "settings-chain-updated": "Đã cập nhật chuỗi phòng khám.",
    "settings-chain-activated": "Đã kích hoạt chuỗi phòng khám.",
    "settings-chain-deactivated": "Đã ngừng hoạt động chuỗi phòng khám.",
    "settings-organization-created": "Đã tạo hệ thống và gửi email thiết lập mật khẩu cho owner.",
    "settings-organization-missing": "Cần nhập tên hệ thống, mã subdomain hợp lệ, tên owner và email owner.",
    "settings-organization-exists": "Mã subdomain/domain này đã được hệ thống khác sử dụng.",
    "settings-clinic-missing": "Cần có tên chi nhánh, thành phố và địa chỉ.",
    "settings-clinic-exists": "Tên chi nhánh này đã tồn tại.",
    "settings-clinic-not-found": "Không tìm thấy chi nhánh trong phạm vi này.",
    "settings-chain-missing": "Cần có tên chuỗi phòng khám.",
    "settings-chain-exists": "Tên chuỗi phòng khám này đã tồn tại.",
    "settings-chain-not-found": "Không tìm thấy chuỗi phòng khám trong phạm vi này.",
    "settings-chain-owner-missing": "Cần chọn chủ chuỗi có sẵn hoặc nhập tên và email chủ chuỗi mới.",
    "settings-clinic-inactive": "Chỉ chọn chi nhánh đang hoạt động cho tài khoản nhân sự.",
    "settings-user-not-found": "Không tìm thấy tài khoản nhân sự trong phạm vi phòng khám này.",
    "settings-database": "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
    "settings-notification-test-missing": "Cần chọn kênh và người nhận để test gửi thông báo.",
    "settings-notification-test-sent": "Đã gửi test thông báo.",
    "settings-notification-test-failed": "Test thông báo thất bại. Kiểm tra cấu hình provider và log gửi.",
    "settings-source-policy-missing": "Cần chọn chính sách nguồn.",
    "settings-source-policy-saved": "Đã lưu chính sách nguồn.",
    "settings-source-accruals-generated": "Đã tính hoa hồng nguồn.",
  },
  en: {
    "settings-chair-created": "Treatment chair added.",
    "settings-chair-updated": "Treatment chair updated.",
    "settings-chair-activated": "Treatment chair activated.",
    "settings-chair-deactivated": "Treatment chair deactivated.",
    "settings-chair-missing": "Treatment chair name is required.",
    "settings-chair-exists": "This chair name already exists in the clinic.",
    "settings-chair-not-found": "The treatment chair could not be found in this scope.",
    "settings-staff-created": "Staff account created and password setup email request created.",
    "settings-password-link-created": "Password setup email request created.",
    "settings-role-updated": "Staff role updated.",
    "settings-status-updated": "Staff status updated.",
    "settings-profile-updated": "Staff profile updated.",
    "settings-profile-missing-fields": "Staff name is required.",
    "settings-profile-bad-date": "Select valid staff profile dates.",
    "settings-profile-bad-number": "Enter valid salary and commission numbers.",
    "settings-profile-bad-avatar": "Profile photo must be an image file.",
    "settings-profile-avatar-large": "Profile photo must be 5 MB or smaller.",
    "settings-profile-code-exists": "Another staff profile already uses that employee code.",
    "settings-denied": "This role cannot change settings.",
    "settings-missing": "Staff name, email, role, and clinic are required.",
    "settings-email-exists": "Another account already uses that email.",
    "settings-self-password-link":
      "For safety, create password setup emails only for other accounts. Use the password reset page for your own account.",
    "settings-clinic-created": "Clinic branch created.",
    "settings-clinic-updated": "Clinic branch updated.",
    "settings-clinic-activated": "Clinic branch activated.",
    "settings-clinic-deactivated": "Clinic branch deactivated.",
    "settings-chain-created": "Clinic chain created.",
    "settings-chain-updated": "Clinic chain updated.",
    "settings-chain-activated": "Clinic chain activated.",
    "settings-chain-deactivated": "Clinic chain deactivated.",
    "settings-organization-created": "System created and owner password setup email sent.",
    "settings-organization-missing": "Enter a system name, valid subdomain code, owner name, and owner email.",
    "settings-organization-exists": "Another system already uses that subdomain/domain.",
    "settings-clinic-missing": "Clinic name, city, and address are required.",
    "settings-clinic-exists": "Another clinic branch already uses that name.",
    "settings-clinic-not-found": "The clinic branch could not be found in this scope.",
    "settings-chain-missing": "Clinic chain name is required.",
    "settings-chain-exists": "Another clinic chain already uses that name.",
    "settings-chain-not-found": "The clinic chain could not be found in this scope.",
    "settings-chain-owner-missing": "Choose an existing chain owner or enter the new owner's name and email.",
    "settings-clinic-inactive": "Choose an active clinic branch for staff accounts.",
    "settings-user-not-found": "The staff account could not be found in this clinic scope.",
    "settings-database": "The settings change could not be saved. Please try again.",
    "settings-notification-test-missing": "Select a channel and recipient for the notification test.",
    "settings-notification-test-sent": "Notification test sent.",
    "settings-notification-test-failed": "Notification test failed. Check provider configuration and delivery logs.",
    "settings-source-policy-missing": "Select a source policy.",
    "settings-source-policy-saved": "Source policy saved.",
    "settings-source-accruals-generated": "Source commission accruals generated.",
  },
};

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();

  return notice ? settingsNotices[language][notice] ?? notice : null;
}

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function patientLeadSourceOptions(language: Language) {
  return language === "vi"
    ? [
        { value: "WALK_IN", label: "Tự đến" },
        { value: "REFERRAL", label: "Giới thiệu" },
        { value: "FACEBOOK", label: "Facebook" },
        { value: "GOOGLE", label: "Google" },
        { value: "WEBSITE", label: "Website" },
        { value: "ZALO", label: "Zalo" },
        { value: "CAMPAIGN", label: "Chiến dịch" },
        { value: "OTHER", label: "Khác" },
      ]
    : [
        { value: "WALK_IN", label: "Walk-in" },
        { value: "REFERRAL", label: "Referral" },
        { value: "FACEBOOK", label: "Facebook" },
        { value: "GOOGLE", label: "Google" },
        { value: "WEBSITE", label: "Website" },
        { value: "ZALO", label: "Zalo" },
        { value: "CAMPAIGN", label: "Campaign" },
        { value: "OTHER", label: "Other" },
      ];
}

export function SettingsPanel({
  settingsWorkspace,
  role,
  clinicCount,
}: {
  settingsWorkspace?: SettingsWorkspace | null;
  role: string;
  clinicCount: number;
}) {
  const { language } = useAppLanguage();
  const text = settingsText[language];
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedSettingsSection = searchParams.get("section");
  const initialSettingsSection =
    requestedSettingsSection &&
    ["accounts", "organization", "archive", "providers", "governance"].includes(
      requestedSettingsSection,
    )
      ? (requestedSettingsSection as
          | "accounts"
          | "organization"
          | "archive"
          | "providers"
          | "governance")
      : "accounts";
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const [settingsModal, setSettingsModal] = useState<"staff" | "staff-config" | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffConfigTab, setStaffConfigTab] = useState<"profile" | "access" | "security">("profile");
  const [settingsSection, setSettingsSection] = useState<
    "accounts" | "organization" | "archive" | "providers" | "governance"
  >(initialSettingsSection);
  const selectSettingsSection = (
    section: "accounts" | "organization" | "archive" | "providers" | "governance",
  ) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("section", section);
    setSettingsSection(section);
    router.replace(`/settings?${nextParams.toString()}`, { scroll: false });
  };
  const [settingsArchiveSearch, setSettingsArchiveSearch] = useState("");
  const setupEmail = searchParams.get("setupEmail");
  const canMutate = settingsWorkspace?.canMutate ?? false;
  const canManageSystems = settingsWorkspace?.canManageSystems ?? false;
  const formClinics = settingsWorkspace?.clinics ?? [];
  const activeFormClinics = formClinics.filter((clinic) => clinic.active);
  const organizations = settingsWorkspace?.organizations ?? [];
  const archivedClinics = settingsWorkspace?.archivedClinics ?? [];
  const notificationSettings = settingsWorkspace?.notificationSettings;
  const aiSettings = settingsWorkspace?.aiSettings;
  const sourceCommission = settingsWorkspace?.sourceCommission ?? {
    policies: [],
    accruals: [],
  };
  const aiRuns = settingsWorkspace?.aiRuns ?? [];
  const [aiAuditQuery, setAiAuditQuery] = useState("");
  const [aiAuditStatus, setAiAuditStatus] = useState("all");
  const [aiAuditModule, setAiAuditModule] = useState("all");
  const aiAuditModules = Array.from(new Set(aiRuns.map((run) => run.module))).sort();
  const normalizedAiAuditQuery = normalizeSearchText(aiAuditQuery);
  const filteredAiRuns = aiRuns.filter((run) => {
    if (aiAuditStatus !== "all" && run.status !== aiAuditStatus) {
      return false;
    }

    if (aiAuditModule !== "all" && run.module !== aiAuditModule) {
      return false;
    }

    if (!normalizedAiAuditQuery) {
      return true;
    }

    return normalizeSearchText(
      [
        run.module,
        run.action,
        run.provider,
        run.model,
        run.status,
        run.actor ?? "",
        run.error ?? "",
      ].join(" "),
    ).includes(normalizedAiAuditQuery);
  });
  const sourceCommissionTotal = sourceCommission.accruals.reduce(
    (total, accrual) => total + accrual.commissionAmount,
    0,
  );
  const leadSourceOptions = patientLeadSourceOptions(language);
  const staff = settingsWorkspace?.staff ?? [];
  const [staffSearch, setStaffSearch] = useState("");
  const [staffRoleFilter, setStaffRoleFilter] = useState<AppRole | "all">("all");
  const auditItems =
    settingsWorkspace?.auditLogs.map(
      (log) => `${log.createdAt} - ${log.actor} - ${log.action} (${log.entityType})`,
    ) ?? auditTrail;
  const roleOptions = Object.entries(roleText[language]) as Array<[AppRole, string]>;
  const staffAccountRoleOptions = roleOptions.filter(([value]) => value !== "PATIENT");
  const organizationWideRoleValues = new Set<AppRole>(["OWNER", "AREA_MANAGER"]);
  const formReady = Boolean(canMutate && formClinics.length > 0);
  const staffCreateReady = Boolean(canMutate && activeFormClinics.length > 0);
  const activeStaff = staff.filter((member) => member.active);
  const pendingPasswordStaff = staff.filter(
    (member) => member.mustChangePassword || member.hasPendingPasswordSetup,
  );
  const ownerStaff = staff.filter((member) => member.role === "OWNER" && member.active);
  const staffSearchQuery = normalizeSearchText(staffSearch);
  const filteredStaff = staff.filter((member) => {
    if (
      staffRoleFilter !== "all" &&
      member.role !== staffRoleFilter &&
      !member.roleAssignments.some((assignment) => assignment.role === staffRoleFilter)
    ) {
      return false;
    }

    if (!staffSearchQuery) {
      return true;
    }

    return normalizeSearchText(
      [
        member.fullName,
        member.email,
        member.phone,
        member.employeeCode,
        member.title,
        member.department,
        member.roleAssignments.map((assignment) => roleText[language][assignment.role]).join(" "),
        member.clinics.map((clinic) => clinic.name).join(" "),
      ].join(" "),
    ).includes(staffSearchQuery);
  });
  const systemOwnerAccounts = filteredStaff.filter((member) => member.role === "OWNER");
  const areaManagerAccounts = filteredStaff.filter((member) => member.role === "AREA_MANAGER");
  const managerAccounts = filteredStaff.filter(
    (member) => member.role === "CLINIC_MANAGER",
  );
  const operatorAccounts = filteredStaff.filter(
    (member) =>
      member.role !== "OWNER" &&
      member.role !== "AREA_MANAGER" &&
      member.role !== "CLINIC_MANAGER" &&
      member.role !== "PATIENT",
  );
  const patientAccounts = filteredStaff.filter((member) => member.role === "PATIENT");
  const archiveSearchQuery = normalizeSearchText(settingsArchiveSearch);
  const filteredArchivedClinics = archivedClinics.filter((clinic) => {
    if (!archiveSearchQuery) {
      return true;
    }

    return normalizeSearchText(
      [
        clinic.name,
        clinic.organizationName,
        clinic.city,
        clinic.latestActivityAt ?? "",
        String(clinic.patientCount),
        String(clinic.appointmentCount),
        String(clinic.invoiceCount),
        String(clinic.receiptCount),
        String(clinic.staffCount),
      ].join(" "),
    ).includes(archiveSearchQuery);
  });
  const archiveResultCount = filteredArchivedClinics.length;
  const staffGroups = [
    {
      key: "system",
      title: language === "vi" ? "Chủ hệ thống" : "System owners",
      description:
        language === "vi"
          ? "Quyền cao nhất toàn tổ chức, cấu hình hệ thống, dữ liệu và tài chính."
          : "Highest organization-level access for system, data, and finance settings.",
      members: systemOwnerAccounts,
    },
    {
      key: "area",
      title: language === "vi" ? "Quản lý khu vực" : "Area managers",
      description:
        language === "vi"
          ? "Quản lý nhiều chi nhánh trong phạm vi hệ thống được giao."
          : "Manages multiple assigned branches inside the system.",
      members: areaManagerAccounts,
    },
    {
      key: "managers",
      title: language === "vi" ? "Quản lý phòng khám" : "Clinic managers",
      description:
        language === "vi"
          ? "Quản lý chi nhánh, lịch hẹn, bệnh nhân, thu tiền, báo cáo và nhân sự tại phạm vi được giao."
          : "Manages assigned branches, schedule, patients, collections, reports, and local staff.",
      members: managerAccounts,
    },
    {
      key: "staff",
      title: language === "vi" ? "Nhân sự" : "Staff",
      description:
        language === "vi"
          ? "Bác sĩ, lễ tân, billing và các vai trò vận hành hằng ngày."
          : "Dentists, front desk, billing, and day-to-day operating roles.",
      members: operatorAccounts,
    },
    {
      key: "patients",
      title: language === "vi" ? "Bệnh nhân" : "Patients",
      description:
        language === "vi"
          ? "Tài khoản portal của bệnh nhân. Hồ sơ hành chính vẫn quản lý trong module Bệnh nhân."
          : "Patient portal accounts. Administrative profile data stays in the Patients module.",
      members: patientAccounts,
    },
  ];
  const settingsSections =
    language === "vi"
      ? [
          { key: "accounts", label: "Tài khoản" },
          { key: "organization", label: "Hệ thống & chi nhánh" },
          { key: "archive", label: "Lưu trữ" },
          { key: "providers", label: "AI & thông báo" },
          { key: "governance", label: "Quyền & kiểm soát" },
        ] as const
      : [
          { key: "accounts", label: "Accounts" },
          { key: "organization", label: "Systems & branches" },
          { key: "archive", label: "Archive" },
          { key: "providers", label: "AI & notifications" },
          { key: "governance", label: "Access & controls" },
        ] as const;
  const roleCounts = roleOptions
    .map(([value, label]) => ({
      label,
      value,
      count: filteredStaff.filter((member) => member.role === value).length,
    }))
    .filter((item) => item.count > 0);
  const permissionMatrix =
    language === "vi"
      ? [
          {
            role: "Chủ hệ thống",
            scope: "Toàn hệ thống",
            access: "Cấu hình, tài chính, nhân sự, dữ liệu, AI và xuất báo cáo.",
            modules: ["Dashboard", "Billing", "Accounting", "Settings", "Reports", "Staff"],
          },
          {
            role: "Quản lý khu vực",
            scope: "Chuỗi/chi nhánh được giao",
            access: "Điều hành nhiều chi nhánh, theo dõi KPI, nhân sự, kho và chăm sóc khách.",
            modules: ["Schedule", "Patients", "Billing", "CRM", "Inventory", "Reports"],
          },
          {
            role: "Quản lý phòng khám",
            scope: "Chi nhánh được phân quyền",
            access: "Quản trị vận hành hằng ngày, lịch hẹn, bệnh nhân, thanh toán và nhân sự tại chi nhánh.",
            modules: ["Schedule", "Patients", "Journey", "Billing", "Staff", "Inventory"],
          },
          {
            role: "Bác sĩ / Hygienist",
            scope: "Bệnh án và chăm sóc lâm sàng",
            access: "Xem Journey, ghi chú lâm sàng, đơn thuốc, biểu mẫu và kế hoạch điều trị.",
            modules: ["Journey", "Clinical", "Pharmacy", "Forms", "Learning"],
          },
          {
            role: "Lễ tân / Billing",
            scope: "Tiếp nhận và doanh thu",
            access: "Đặt lịch, hồ sơ hành chính, thu tiền, hóa đơn, biểu mẫu và nhắc hẹn.",
            modules: ["Schedule", "Patients", "Billing", "Forms", "CRM"],
          },
          {
            role: "Bệnh nhân",
            scope: "Hồ sơ liên kết của chính mình",
            access: "Xem lịch hẹn, hóa đơn, kế hoạch điều trị, tài liệu và biểu mẫu được gửi.",
            modules: ["Patient app"],
          },
        ]
      : [
          {
            role: "Owner",
            scope: "Whole system",
            access: "System configuration, finance, staff, data, AI, and reporting exports.",
            modules: ["Dashboard", "Billing", "Accounting", "Settings", "Reports", "Staff"],
          },
          {
            role: "Area manager",
            scope: "Assigned chain/branches",
            access: "Multi-branch operations, KPI review, staffing, inventory, and customer care.",
            modules: ["Schedule", "Patients", "Billing", "CRM", "Inventory", "Reports"],
          },
          {
            role: "Clinic manager",
            scope: "Assigned branch",
            access: "Daily branch operations, schedule, patients, collections, and local staff.",
            modules: ["Schedule", "Patients", "Journey", "Billing", "Staff", "Inventory"],
          },
          {
            role: "Dentist / Hygienist",
            scope: "Clinical record and care delivery",
            access: "View Journey, write clinical notes, prescriptions, forms, and treatment plans.",
            modules: ["Journey", "Clinical", "Pharmacy", "Forms", "Learning"],
          },
          {
            role: "Front desk / Billing",
            scope: "Reception and revenue workflow",
            access: "Bookings, administrative profile, collections, invoices, forms, and recalls.",
            modules: ["Schedule", "Patients", "Billing", "Forms", "CRM"],
          },
          {
            role: "Patient",
            scope: "Own linked profile",
            access: "Appointments, invoices, treatment plans, documents, and assigned forms.",
            modules: ["Patient app"],
          },
        ];
  const notificationMode = notificationSettings?.deliveryMode ?? "unknown";
  const notificationReadiness =
    language === "vi"
      ? [
          {
            label: "Chế độ hiện tại",
            value: notificationMode,
            status:
              notificationMode === "disabled"
                ? "Cần cấu hình"
                : notificationMode === "log" || notificationMode === "demo"
                  ? "Chỉ ghi log"
                  : "Sẵn sàng gửi",
          },
          {
            label: "Email Resend",
            value: notificationSettings?.resendFromEmail ?? "Chưa cấu hình",
            status:
              notificationMode === "resend" && notificationSettings?.resendFromEmail
                ? "Sẵn sàng"
                : "Không dùng",
          },
          {
            label: "Webhook SMS/Zalo/Email",
            value: "Dùng biến môi trường kênh hoặc fallback",
            status: notificationMode === "webhook" ? "Đang bật" : "Không dùng",
          },
        ]
      : [
          {
            label: "Current mode",
            value: notificationMode,
            status:
              notificationMode === "disabled"
                ? "Needs config"
                : notificationMode === "log" || notificationMode === "demo"
                  ? "Log only"
                  : "Delivery ready",
          },
          {
            label: "Resend email",
            value: notificationSettings?.resendFromEmail ?? "Not configured",
            status:
              notificationMode === "resend" && notificationSettings?.resendFromEmail
                ? "Ready"
                : "Unused",
          },
          {
            label: "SMS/Zalo/Email webhook",
            value: "Uses channel env vars or fallback URL",
            status: notificationMode === "webhook" ? "Enabled" : "Unused",
          },
        ];
  const aiProviderReadiness =
    language === "vi"
      ? [
          {
            label: "Trạng thái",
            value: aiSettings?.enabled ? "Đang bật" : "Đang tắt",
            status: aiSettings?.error ? "Cần kiểm tra" : aiSettings?.enabled ? "Sẵn sàng" : "Không gọi AI",
          },
          {
            label: "Provider",
            value: aiSettings?.provider ?? "openai-compatible",
            status: aiSettings?.baseUrlConfigured ? "Có base URL" : "Chưa có base URL",
          },
          {
            label: "Model",
            value: aiSettings?.model ?? "cx/gpt-5.5",
            status: aiSettings?.error ? "Lỗi cấu hình" : "Đã chọn",
          },
        ]
      : [
          {
            label: "Status",
            value: aiSettings?.enabled ? "Enabled" : "Disabled",
            status: aiSettings?.error ? "Check config" : aiSettings?.enabled ? "Ready" : "No AI calls",
          },
          {
            label: "Provider",
            value: aiSettings?.provider ?? "openai-compatible",
            status: aiSettings?.baseUrlConfigured ? "Base URL set" : "No base URL",
          },
          {
            label: "Model",
            value: aiSettings?.model ?? "cx/gpt-5.5",
            status: aiSettings?.error ? "Config error" : "Selected",
          },
        ];
  const confirmText =
    language === "vi"
      ? {
          chainStatus: "Bạn chắc chắn muốn đổi trạng thái chuỗi này? Chi nhánh trong chuỗi có thể bị ảnh hưởng ở báo cáo và vận hành.",
          clinicStatus: "Bạn chắc chắn muốn đổi trạng thái chi nhánh này? Chi nhánh ngừng hoạt động sẽ bị ẩn khỏi vận hành hằng ngày.",
          passwordSetup: "Tạo email thiết lập mật khẩu mới cho nhân sự này? Link cũ chưa dùng sẽ bị vô hiệu hóa.",
          sourceCommissionPaid: "Bạn chắc chắn muốn đánh dấu khoản hoa hồng nguồn này là đã chi?",
          staffStatus: "Bạn chắc chắn muốn đổi trạng thái hoạt động của nhân sự này?",
        }
      : {
          chainStatus: "Are you sure you want to change this chain's status? Branch reporting and operations can be affected.",
          clinicStatus: "Are you sure you want to change this branch's status? Inactive branches are hidden from daily operations.",
          passwordSetup: "Create a new password setup email for this staff member? Any unused old link will be invalidated.",
          sourceCommissionPaid: "Are you sure you want to mark this source commission accrual as paid?",
          staffStatus: "Are you sure you want to change this staff member's active status?",
        };
  const chairLabels =
    language === "vi"
      ? {
          activateChair: "Kích hoạt ghế",
          addChair: "Thêm ghế",
          chairName: "Tên ghế",
          confirmChairStatus: "Bạn chắc chắn muốn đổi trạng thái ghế này? Ghế ngừng dùng sẽ ẩn khỏi lịch hẹn.",
          general: "Tổng quát",
          implant: "Implant",
          inactiveChairs: "Ghế ngừng dùng",
          noChairs: "Chưa có ghế điều trị",
          orthodontics: "Chỉnh nha",
          saveChair: "Lưu ghế",
          specialty: "Loại ghế",
          surgery: "Tiểu phẫu",
          treatmentChairs: "Ghế điều trị",
          deactivateChair: "Ngừng dùng ghế",
        }
      : {
          activateChair: "Activate chair",
          addChair: "Add chair",
          chairName: "Chair name",
          confirmChairStatus: "Are you sure you want to change this chair status? Inactive chairs are hidden from scheduling.",
          general: "General",
          implant: "Implant",
          inactiveChairs: "Inactive chairs",
          noChairs: "No treatment chairs",
          orthodontics: "Orthodontics",
          saveChair: "Save chair",
          specialty: "Chair type",
          surgery: "Minor surgery",
          treatmentChairs: "Treatment chairs",
          deactivateChair: "Deactivate chair",
        };
  const accountLabels =
    language === "vi"
      ? {
          accessMatrix: "Ma trận quyền",
          accountControls: "Quyền và bảo mật",
          accessRoles: "Quyền truy cập",
          accessScope: "Phạm vi quyền",
          configureStaff: "Cấu hình",
          auditSubtitle: "Thay đổi gần nhất trong hệ thống",
          clinicScope: "Phạm vi phòng khám",
          createPasswordLink: "Gửi email thiết lập mật khẩu",
          createStaffTitle: "Tạo tài khoản nhân sự",
          commissionRate: "Hoa hồng %",
          contractType: "Loại hợp đồng",
          dateOfBirth: "Ngày sinh",
          department: "Bộ phận",
          editProfile: "Chỉnh sửa hồ sơ",
          employeeCode: "Mã nhân sự",
          female: "Nữ",
          gender: "Giới tính",
          hireDate: "Ngày vào làm",
          lastLogin: "Đăng nhập gần nhất",
          male: "Nam",
          manageStaff: "Quản lý nhân sự",
          notProvided: "Chưa bổ sung",
          otherGender: "Khác",
          passwordChanged: "Đã đổi mật khẩu",
          passwordPending: "Chờ thiết lập mật khẩu",
          primaryClinic: "Chi nhánh chính",
          profileDetails: "Thông tin hồ sơ",
          profileCompleteness: "Mức hoàn thiện hồ sơ",
          profileFieldsReady: "trường đã có",
          profilePhoto: "Ảnh hồ sơ",
          salary: "Lương cơ bản",
          saveProfile: "Lưu hồ sơ",
          securityPosture: "Trạng thái bảo mật",
          globalScope: "Toàn hệ thống",
          roleScopeHint: "Chức vụ là thông tin hồ sơ; quyền truy cập quyết định module và thao tác được phép.",
          profileTab: "Hồ sơ",
          accessTab: "Quyền truy cập",
          securityTab: "Bảo mật",
          moduleAccess: "Module được mở",
          setupEmailQueued: "Yêu cầu gửi email thiết lập mật khẩu đã được tạo.",
          setupLinkNote: "Vì lý do bảo mật, hệ thống không hiển thị link trong giao diện. Email chỉ gửi thật khi bạn đã cấu hình dịch vụ gửi email/notification.",
          setupLinkReady: "Email thiết lập mật khẩu",
          setupRecipient: "Người nhận",
          selfPasswordLinkBlocked: "Không thể tạo cho chính bạn",
          staffDirectory: "Danh sách tài khoản",
          title: "Chức vụ / chức danh công việc",
          totalStaff: "Tài khoản",
          pendingSetup: "Chờ mật khẩu",
          activeOwners: "Chủ hệ thống hoạt động",
          addChain: "Thêm chuỗi",
          addClinic: "Thêm chi nhánh",
          address: "Địa chỉ",
          assignedChains: "Chuỗi phụ trách",
          brandName: "Tên thương hiệu",
          chain: "Chuỗi",
          chainOwner: "Chủ chuỗi",
          chainOwnerHint: "Gán owner có sẵn hoặc tạo tài khoản chủ chuỗi mới. Tài khoản mới sẽ nhận email thiết lập mật khẩu.",
          existingChainOwner: "Gán owner có sẵn",
          chainScope: "Chuỗi phòng khám",
          systemScope: "Hệ thống",
          addOrganization: "Tạo hệ thống",
          organizationName: "Tên hệ thống",
          tenantSlug: "Mã truy cập/subdomain",
          tenantDomain: "Domain",
          tenantSlugHint: "Chỉ dùng chữ thường, số và dấu gạch ngang. Ví dụ: bsthinh → bsthinh.codexdentist.com.",
          tenantOwner: "Chủ hệ thống",
          chainNote: "Nền tảng quản lý đa chuỗi: mỗi chi nhánh nên thuộc một chuỗi để sau này tách báo cáo, quyền và vận hành.",
          archivedClinicData: "Dữ liệu lưu trữ",
          archivedClinicNote: "Dữ liệu chi nhánh đã ngừng hoạt động được ẩn khỏi vận hành chính. Kích hoạt lại chi nhánh nếu cần mở đầy đủ lịch, bệnh nhân, thanh toán và hồ sơ.",
          archivedClinics: "Chi nhánh ngừng hoạt động",
          archive: "Lưu trữ",
          archivedChains: "Chuỗi ngừng hoạt động",
          archiveEmpty: "Không có chi nhánh ngừng hoạt động khớp với tìm kiếm.",
          archiveSearch: "Tìm kho lưu trữ",
          archiveSearchPlaceholder: "Tên chi nhánh, thành phố, mã thuế",
          appointments: "Lịch hẹn",
          visibleClinics: "Phòng khám",
          cancel: "Hủy",
          deactivateClinic: "Ngừng hoạt động",
          phone: "Điện thoại",
          legalName: "Tên pháp lý",
          specialty: "Chuyên khoa",
          taxCode: "Mã số thuế",
          website: "Website",
          activateClinic: "Kích hoạt",
          deactivateChain: "Ngừng chuỗi",
          activateChain: "Kích hoạt chuỗi",
          saveChain: "Lưu chuỗi",
          saveClinic: "Lưu chi nhánh",
          latestActivity: "Hoạt động gần nhất",
          patients: "Bệnh nhân",
          receipts: "Phiếu thu",
          invoices: "Hóa đơn",
          notificationSettings: "Cấu hình gửi thông báo",
          notificationMode: "Chế độ gửi",
          recentFailed: "Lỗi 7 ngày",
          recentSent: "Đã gửi 7 ngày",
          resendFrom: "Email gửi đi",
          notificationChannel: "Kênh",
          notificationRecipient: "Người nhận test",
          notificationSubject: "Tiêu đề test",
          notificationBody: "Nội dung test",
          notificationProviderStatus: "Trạng thái provider",
          notificationProviderHint:
            "Không hiển thị API key hoặc webhook secret trong giao diện. Cấu hình thật nằm trong biến môi trường và log gửi.",
          notificationTest: "Gửi test",
          aiAudit: "Lịch sử AI",
          aiAuditSubtitle: "Lần gọi gần nhất",
          aiAuditSearch: "Tìm module, actor, model, lỗi",
          aiProviderHint:
            "Settings chỉ hiển thị trạng thái cấu hình AI. API key và base URL đầy đủ không được đưa ra client.",
          aiProviderStatus: "Trạng thái provider AI",
          allModules: "Tất cả module",
          allStatuses: "Tất cả trạng thái",
          aiTokens: "Tokens",
          newChainOwner: "Tạo chủ chuỗi mới",
          noChainOwner: "Chưa gán chủ chuỗi",
          noOwnerChange: "Chưa gán",
          ownerEmail: "Email chủ hệ thống",
          ownerFullName: "Tên chủ hệ thống",
          sourceCommission: "Hoa hồng nguồn khách",
          sourcePolicy: "Chính sách nguồn",
          addSourcePolicy: "Lưu chính sách",
          advancedDetails: "Thông tin bổ sung",
          sourceOwner: "Người/nhóm sở hữu",
          sourceRate: "% hoa hồng",
          fixedAmount: "Thưởng cố định",
          monthlyBudget: "Chi phí tháng",
          generateAccruals: "Tính hoa hồng nguồn",
          recentAccruals: "Accrual gần nhất",
          approve: "Duyệt",
          markPaid: "Đã chi",
          exportCsv: "Xuất CSV",
          staffAccounts: "Nhân sự",
          staffFilterAllRoles: "Tất cả vai trò",
          patientAccountNote: "Tài khoản bệnh nhân được quản lý từ hồ sơ bệnh nhân.",
          staffSearch: "Tìm nhân sự",
          staffSearchPlaceholder: "Tên, email, mã, chức vụ, chi nhánh",
        }
      : {
          accessMatrix: "Access matrix",
          accountControls: "Access and security",
          accessRoles: "Access roles",
          accessScope: "Access scope",
          configureStaff: "Configure",
          auditSubtitle: "Latest system changes",
          clinicScope: "Clinic scope",
          createPasswordLink: "Send password setup email",
          createStaffTitle: "Create staff account",
          commissionRate: "Tỷ lệ hoa hồng (%)",
          contractType: "Contract type",
          dateOfBirth: "Date of birth",
          department: "Department",
          editProfile: "Edit profile",
          employeeCode: "Employee code",
          female: "Female",
          gender: "Gender",
          hireDate: "Hire date",
          lastLogin: "Last login",
          male: "Male",
          manageStaff: "Manage staff",
          notProvided: "Not added",
          otherGender: "Other",
          passwordChanged: "Password changed",
          passwordPending: "Password setup pending",
          primaryClinic: "Primary branch",
          profileDetails: "Profile details",
          profileCompleteness: "Profile completeness",
          profileFieldsReady: "fields ready",
          profilePhoto: "Profile photo",
          salary: "Base salary",
          saveProfile: "Save profile",
          securityPosture: "Security posture",
          globalScope: "Whole system",
          roleScopeHint: "Job title is profile information; access roles decide modules and allowed actions.",
          profileTab: "Profile",
          accessTab: "Access",
          securityTab: "Security",
          moduleAccess: "Module access",
          setupEmailQueued: "Password setup email request has been created.",
          setupLinkNote: "For security, the setup link is not shown in the app. Email is only delivered when an email/notification service is configured.",
          setupLinkReady: "Password setup email",
          setupRecipient: "Recipient",
          selfPasswordLinkBlocked: "Unavailable for yourself",
          staffDirectory: "Staff directory",
          title: "Job title / position",
          totalStaff: "Accounts",
          pendingSetup: "Pending setup",
          activeOwners: "Active owners",
          addChain: "Add chain",
          addClinic: "Add branch",
          address: "Address",
          assignedChains: "Assigned chains",
          brandName: "Brand name",
          chain: "Chain",
          chainOwner: "Chain owner",
          chainOwnerHint: "Assign an existing owner or create a new chain owner account. New accounts receive a password setup email.",
          existingChainOwner: "Assign existing owner",
          chainScope: "Clinic chains",
          systemScope: "Systems",
          addOrganization: "Create system",
          organizationName: "System name",
          tenantSlug: "Access code/subdomain",
          tenantDomain: "Domain",
          tenantSlugHint: "Use lowercase letters, numbers, and hyphens only. Example: bsthinh → bsthinh.codexdentist.com.",
          tenantOwner: "System owner",
          chainNote: "Multi-chain foundation: assign each branch to a chain for future reporting, access, and operations.",
          archivedClinicData: "Archived data",
          archivedClinicNote: "Inactive branch data is hidden from daily operations. Reactivate the branch when you need full access to schedule, patients, billing, and records.",
          archivedClinics: "Inactive branches",
          archive: "Archive",
          archivedChains: "Inactive chains",
          archiveEmpty: "No inactive branches match this search.",
          archiveSearch: "Search archive",
          archiveSearchPlaceholder: "Branch, city, tax code",
          appointments: "Appointments",
          visibleClinics: "Clinics",
          cancel: "Cancel",
          deactivateClinic: "Deactivate",
          phone: "Phone",
          legalName: "Legal name",
          specialty: "Specialty",
          taxCode: "Tax code",
          website: "Website",
          activateClinic: "Activate",
          deactivateChain: "Deactivate chain",
          activateChain: "Activate chain",
          saveChain: "Save chain",
          saveClinic: "Save branch",
          latestActivity: "Latest activity",
          patients: "Patients",
          receipts: "Receipts",
          invoices: "Invoices",
          notificationSettings: "Notification settings",
          notificationMode: "Delivery mode",
          recentFailed: "Failed 7 days",
          recentSent: "Sent 7 days",
          resendFrom: "From email",
          notificationChannel: "Channel",
          notificationRecipient: "Test recipient",
          notificationSubject: "Test subject",
          notificationBody: "Test body",
          notificationProviderStatus: "Provider status",
          notificationProviderHint:
            "API keys and webhook secrets are never shown in the UI. Real provider setup lives in environment variables and delivery logs.",
          notificationTest: "Send test",
          aiAudit: "AI history",
          aiAuditSubtitle: "Recent runs",
          aiAuditSearch: "Search module, actor, model, error",
          aiProviderHint:
            "Settings only shows AI configuration status. API keys and full base URLs are never sent to the client.",
          aiProviderStatus: "AI provider status",
          allModules: "All modules",
          allStatuses: "All statuses",
          aiTokens: "Tokens",
          newChainOwner: "Create new chain owner",
          noChainOwner: "No chain owner",
          noOwnerChange: "Unassigned",
          ownerEmail: "Owner email",
          ownerFullName: "Owner full name",
          sourceCommission: "Source commission",
          sourcePolicy: "Source policy",
          addSourcePolicy: "Save policy",
          advancedDetails: "More details",
          sourceOwner: "Owner/team",
          sourceRate: "Commission %",
          fixedAmount: "Fixed bonus",
          monthlyBudget: "Monthly cost",
          generateAccruals: "Generate source commission",
          recentAccruals: "Recent accruals",
          approve: "Approve",
          markPaid: "Mark paid",
          exportCsv: "Export CSV",
          staffAccounts: "Staff",
          staffFilterAllRoles: "All roles",
          patientAccountNote: "Patient accounts are managed from the patient profile.",
          staffSearch: "Search staff",
          staffSearchPlaceholder: "Name, email, code, title, branch",
        };
  const selectedStaff = selectedStaffId
    ? staff.find((member) => member.id === selectedStaffId) ?? null
    : null;
  const selectedStaffIsPatient = selectedStaff?.role === "PATIENT";
  const selectedStaffClinicOptions = selectedStaff
    ? selectedStaff.clinics.filter((clinic) => clinic.active).length > 0
      ? selectedStaff.clinics.filter((clinic) => clinic.active)
      : activeFormClinics
    : activeFormClinics;
  const selectedStaffAssignments =
    selectedStaff?.roleAssignments.filter((assignment) => assignment.active) ?? [];
  const selectedStaffAssignmentRoles = new Set(
    selectedStaffAssignments.map((assignment) => assignment.role),
  );
  const selectedStaffAssignmentClinicId =
    selectedStaffAssignments.find((assignment) => assignment.clinicId)?.clinicId ??
    selectedStaff?.primaryClinicId ??
    selectedStaff?.clinics[0]?.id ??
    activeFormClinics[0]?.id ??
    "";

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{text.admin}</p>
          <h2>{text.heading}</h2>
        </div>
        <div className="service-action-row">
          <button
            className="primary-button"
            type="button"
            disabled={!staffCreateReady}
            onClick={() => setSettingsModal("staff")}
          >
            <UsersRound size={16} />
            {text.createStaff}
          </button>
          <SourceBadge source={settingsWorkspace?.source} />
        </div>
      </div>

      {(settingsWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(settingsWorkspace?.message, language)}
        </div>
      )}
      {setupEmail && (
        <div className="credential-box">
          <strong>{accountLabels.setupLinkReady}</strong>
          <span>{accountLabels.setupEmailQueued}</span>
          <small>
            {accountLabels.setupRecipient}: {setupEmail}
          </small>
          <small>{accountLabels.setupLinkNote}</small>
        </div>
      )}

      <section className="metric-grid settings-metric-grid">
        <MetricCard label={accountLabels.totalStaff} value={String(staff.length)} tone="blue" />
        <MetricCard label={text.active} value={String(activeStaff.length)} tone="green" />
        <MetricCard label={accountLabels.pendingSetup} value={String(pendingPasswordStaff.length)} tone="teal" />
        <MetricCard label={accountLabels.activeOwners} value={String(ownerStaff.length)} tone="violet" />
        <MetricCard label={accountLabels.systemScope} value={String(organizations.length)} tone="violet" />
        <MetricCard label={accountLabels.visibleClinics} value={String(formClinics.length)} tone="blue" />
      </section>

      <div className="segmented settings-section-tabs" role="tablist" aria-label={text.admin}>
        {settingsSections.map((section) => (
          <button
            aria-selected={settingsSection === section.key}
            className={settingsSection === section.key ? "active" : ""}
            key={section.key}
            onClick={() => selectSettingsSection(section.key)}
            role="tab"
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <section className="settings-overview-grid" data-settings-section={settingsSection}>
        <section className="panel settings-staff-panel" data-settings-block="accounts">
          <PanelHeader icon={UsersRound} title={accountLabels.staffDirectory} action={accountLabels.manageStaff} />
          <div className="settings-clinic-form">
            <label>
              {accountLabels.staffSearch}
              <input
                value={staffSearch}
                onChange={(event) => setStaffSearch(event.target.value)}
                placeholder={accountLabels.staffSearchPlaceholder}
              />
            </label>
            <label>
              {text.role}
              <select
                value={staffRoleFilter}
                onChange={(event) => setStaffRoleFilter(event.target.value as AppRole | "all")}
              >
                <option value="all">{accountLabels.staffFilterAllRoles}</option>
                {roleOptions.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="settings-role-chips">
            {roleCounts.map((item) => (
              <span key={item.value}>{item.label}: {item.count}</span>
            ))}
          </div>
          <div className="settings-account-groups">
            {filteredStaff.length > 0 ? (
              staffGroups.map((group) => (
                <section className="settings-account-group" key={group.key}>
                  <div className="settings-account-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.description}</span>
                    </div>
                    <b>{group.members.length}</b>
                  </div>
                  <div className="settings-staff-grid">
                    {group.members.length > 0 ? (
                      group.members.map((member) => {
                const memberClinicOptions =
                  member.clinics.filter((clinic) => clinic.active).length > 0
                    ? member.clinics.filter((clinic) => clinic.active)
                    : activeFormClinics;
                const isPatientAccount = member.role === "PATIENT";
                const activeRoleAssignments = member.roleAssignments.filter(
                  (assignment) => assignment.active,
                );
                const roleAssignmentRoles = new Set(
                  activeRoleAssignments.map((assignment) => assignment.role),
                );
                const assignmentClinicId =
                  activeRoleAssignments.find((assignment) => assignment.clinicId)?.clinicId ??
                  member.primaryClinicId ??
                  member.clinics[0]?.id ??
                  activeFormClinics[0]?.id ??
                  "";
                const completedProfileFields = [
                  member.employeeCode,
                  member.title,
                  member.department,
                  member.contractType,
                  member.primaryClinicId,
                  member.hireDateIso,
                  member.baseSalary,
                ].filter(Boolean).length;
                const profileFieldTotal = 7;
                const profileCompletionPercent = Math.round(
                  (completedProfileFields / profileFieldTotal) * 100,
                );

                return (
                <article className="settings-staff-card compact" key={member.id}>
                  <div className="settings-staff-card-head">
                    <div className="settings-staff-identity">
                      <div className="settings-staff-avatar">
                        {member.avatarUrl ? (
                          <img src={member.avatarUrl} alt={member.fullName} />
                        ) : (
                          <span>{member.fullName.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <strong>{member.fullName}</strong>
                        <span>{member.email}</span>
                      </div>
                    </div>
                    <StatusPill status={member.active ? "Active" : "Inactive"} />
                  </div>
                  <div className="settings-staff-quickline">
                    <span>{accountLabels.title}: {member.title ?? accountLabels.notProvided}</span>
                    <span>{member.clinics.map((clinic) => clinic.name).join(", ") || text.noClinic}</span>
                  </div>
                  {!isPatientAccount && (
                    <div className="settings-role-chips">
                      {(activeRoleAssignments.length > 0
                        ? activeRoleAssignments
                        : [{ role: member.role, clinicName: null, scope: "GLOBAL" as const }]
                      ).map((assignment) => (
                        <span
                          key={`${member.id}-${assignment.role}-${assignment.clinicName ?? "global"}`}
                        >
                          {roleText[language][assignment.role]} ·{" "}
                          {assignment.scope === "GLOBAL"
                            ? accountLabels.globalScope
                            : assignment.clinicName ?? text.clinic}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="settings-staff-profile-summary">
                    {isPatientAccount ? (
                      <span>{accountLabels.patientAccountNote}</span>
                    ) : (
                      <>
                        <span>{accountLabels.employeeCode}: {member.employeeCode ?? accountLabels.notProvided}</span>
                      </>
                    )}
                    <span>{accountLabels.lastLogin}: {member.lastLoginAt ?? "-"}</span>
                  </div>
                  {!isPatientAccount && (
                    <div className="settings-profile-completeness">
                      <div>
                        <strong>{accountLabels.profileCompleteness}</strong>
                        <span>
                          {completedProfileFields}/{profileFieldTotal} {accountLabels.profileFieldsReady}
                        </span>
                      </div>
                      <div className="settings-profile-completeness-track" aria-hidden="true">
                        <span style={{ width: `${profileCompletionPercent}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="settings-password-state">
                    <LockKeyhole size={14} />
                    <span>
                      {member.mustChangePassword || member.hasPendingPasswordSetup
                        ? accountLabels.passwordPending
                        : member.passwordChangedAt
                          ? `${accountLabels.passwordChanged}: ${member.passwordChangedAt}`
                          : accountLabels.passwordChanged}
                    </span>
                  </div>
                  <div className="settings-staff-card-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => {
                        setSelectedStaffId(member.id);
                        setStaffConfigTab(isPatientAccount ? "security" : "profile");
                        setSettingsModal("staff-config");
                      }}
                    >
                      {accountLabels.configureStaff}
                    </button>
                  </div>
                  <details className="settings-staff-account-editor">
                    <summary>{accountLabels.accountControls}</summary>
                    <div className="settings-staff-actions">
                      {!isPatientAccount && (
                        <form action={updateStaffRoleAction} className="settings-role-assignment-form">
                          <input name="userId" type="hidden" value={member.id} />
                          <label>
                            {accountLabels.accessScope}
                            <select
                              name="assignmentClinicId"
                              defaultValue={assignmentClinicId}
                              disabled={!formReady}
                            >
                              {activeFormClinics.map((clinic) => (
                                <option value={clinic.id} key={clinic.id}>
                                  {clinic.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <fieldset>
                            <legend>{accountLabels.accessRoles}</legend>
                            <div className="settings-role-checkbox-grid">
                              {staffAccountRoleOptions.map(([value, label]) => (
                                <label key={`${member.id}-${value}`}>
                                  <input
                                    name="assignmentRole"
                                    type="checkbox"
                                    value={value}
                                    defaultChecked={
                                      roleAssignmentRoles.has(value) ||
                                      (roleAssignmentRoles.size === 0 && member.role === value)
                                    }
                                    disabled={!formReady}
                                  />
                                  <span>
                                    {label}
                                    <small>
                                      {organizationWideRoleValues.has(value)
                                        ? accountLabels.globalScope
                                        : accountLabels.accessScope}
                                    </small>
                                  </span>
                                </label>
                              ))}
                            </div>
                            <small>{accountLabels.roleScopeHint}</small>
                          </fieldset>
                          <button type="submit" disabled={!formReady}>
                            {text.save}
                          </button>
                        </form>
                      )}
                      <form
                        action={toggleStaffStatusAction}
                        onSubmit={(event) => {
                          if (!window.confirm(confirmText.staffStatus)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="userId" type="hidden" value={member.id} />
                        <input
                          name="active"
                          type="hidden"
                          value={member.active ? "false" : "true"}
                        />
                        <button type="submit" disabled={!formReady}>
                          {member.active ? text.deactivate : text.activate}
                        </button>
                      </form>
                      <form
                        action={createStaffPasswordSetupLinkAction}
                        onSubmit={(event) => {
                          if (!window.confirm(confirmText.passwordSetup)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="userId" type="hidden" value={member.id} />
                        <button
                          type="submit"
                          disabled={!formReady || !member.canCreatePasswordSetup}
                          title={
                            member.canCreatePasswordSetup
                              ? accountLabels.createPasswordLink
                              : accountLabels.selfPasswordLinkBlocked
                          }
                        >
                          {member.canCreatePasswordSetup
                            ? accountLabels.createPasswordLink
                            : accountLabels.selfPasswordLinkBlocked}
                        </button>
                      </form>
                    </div>
                  </details>
                  {!isPatientAccount && (
                  <details className="settings-staff-profile-editor">
                    <summary>{accountLabels.editProfile}</summary>
                    <form action={updateStaffProfileAction}>
                      <input name="userId" type="hidden" value={member.id} />
                      <label>
                        {text.fullName}
                        <input name="fullName" defaultValue={member.fullName} disabled={!formReady} required />
                      </label>
                      <label>
                        {accountLabels.phone}
                        <input name="phone" defaultValue={member.phone ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.employeeCode}
                        <input name="employeeCode" defaultValue={member.employeeCode ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.title}
                        <input name="title" defaultValue={member.title ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.department}
                        <input name="department" defaultValue={member.department ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.contractType}
                        <select name="contractType" defaultValue={member.contractType ?? "FULL_TIME"} disabled={!formReady}>
                          <option value="FULL_TIME">Full-time</option>
                          <option value="PART_TIME">Part-time</option>
                          <option value="CONTRACTOR">Contractor</option>
                          <option value="INTERN">Intern</option>
                        </select>
                      </label>
                      <label>
                        {accountLabels.primaryClinic}
                        <select name="clinicId" defaultValue={member.primaryClinicId ?? memberClinicOptions[0]?.id ?? ""} disabled={!formReady}>
                          <option value="">{text.noClinic}</option>
                          {memberClinicOptions.map((clinic) => (
                            <option value={clinic.id} key={clinic.id}>
                              {clinic.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {accountLabels.gender}
                        <select name="gender" defaultValue={member.gender ?? ""} disabled={!formReady}>
                          <option value="">{accountLabels.notProvided}</option>
                          <option value="Nam">{accountLabels.male}</option>
                          <option value="Nữ">{accountLabels.female}</option>
                          <option value="Khác">{accountLabels.otherGender}</option>
                        </select>
                      </label>
                      <label>
                        {accountLabels.dateOfBirth}
                        <input name="dateOfBirth" type="date" defaultValue={member.dateOfBirthIso ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.hireDate}
                        <input name="hireDate" type="date" defaultValue={member.hireDateIso ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.salary}
                        <input name="baseSalary" inputMode="decimal" defaultValue={member.baseSalary ?? ""} disabled={!formReady} />
                      </label>
                      <label>
                        {accountLabels.commissionRate}
                        <input name="commissionRate" inputMode="decimal" defaultValue={member.commissionRate ?? ""} disabled={!formReady} />
                      </label>
                      <label className="settings-profile-file-field">
                        {accountLabels.profilePhoto}
                        <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!formReady} />
                      </label>
                      <button type="submit" disabled={!formReady}>
                        {accountLabels.saveProfile}
                      </button>
                    </form>
                  </details>
                  )}
                </article>
                );
                      })
                    ) : (
                      <EmptyState label={group.title} />
                    )}
                  </div>
                </section>
              ))
            ) : (
              <EmptyState label={text.noStaff} />
            )}
          </div>
        </section>

        <aside className="settings-side-stack">
          <section className="panel" data-settings-block="organization">
            <PanelHeader icon={Building2} title={accountLabels.systemScope} action={`${organizations.length}`} />
            <div className="settings-clinic-list">
              {canManageSystems && (
                <form action={createOrganizationAction} className="settings-clinic-form">
                  <input name="name" placeholder={accountLabels.organizationName} disabled={!canMutate} required />
                  <input
                    name="slug"
                    placeholder={accountLabels.tenantSlug}
                    disabled={!canMutate}
                    pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                    minLength={3}
                    maxLength={40}
                    required
                  />
                  <input name="ownerFullName" placeholder={accountLabels.ownerFullName} disabled={!canMutate} required />
                  <input name="ownerEmail" type="email" placeholder={accountLabels.ownerEmail} disabled={!canMutate} required />
                  <small className="settings-form-hint">{accountLabels.tenantSlugHint}</small>
                  <button type="submit" disabled={!canMutate}>
                    {accountLabels.addOrganization}
                  </button>
                </form>
              )}
              {organizations.map((organization) => (
                <article className="settings-archive-row" key={organization.id}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{organization.name}</strong>
                      <span>{organization.primaryDomain ?? "-"}</span>
                    </div>
                    <StatusPill status={organization.slug ? "ACTIVE" : "PENDING"} />
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.tenantSlug}: {organization.slug ?? "-"}</span>
                    <span>{accountLabels.staffAccounts}: {organization.userCount}</span>
                    <span>{accountLabels.activeOwners}: {organization.ownerCount}</span>
                    <span>{accountLabels.visibleClinics}: {organization.clinicCount}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel" data-settings-block="organization">
            <PanelHeader icon={Building2} title={accountLabels.clinicScope} action={`${formClinics.length}`} />
            <div className="settings-clinic-list">
              <form action={createClinicAction} className="settings-clinic-form">
                {canManageSystems && (
                  <select name="organizationId" disabled={!canMutate} required>
                    {organizations.map((organization) => (
                      <option value={organization.id} key={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                )}
                <input name="name" placeholder={accountLabels.addClinic} disabled={!canMutate} required />
                <input name="city" placeholder={text.city} disabled={!canMutate} required />
                <input name="address" placeholder={accountLabels.address} disabled={!canMutate} required />
                <input name="phone" placeholder={accountLabels.phone} disabled={!canMutate} />
                <button type="submit" disabled={!canMutate}>
                  {accountLabels.addClinic}
                </button>
              </form>
              {formClinics.map((clinic) => (
                <article className="settings-clinic-row" key={clinic.id}>
                  <form action={updateClinicAction} className="settings-clinic-edit-form">
                    <input name="clinicId" type="hidden" value={clinic.id} />
                    {!canManageSystems && <input name="organizationId" type="hidden" value={clinic.organizationId} />}
                    <div className="settings-clinic-status">
                      <div>
                        <strong>{clinic.name}</strong>
                        {canManageSystems && <span>{clinic.organizationName}</span>}
                      </div>
                      <StatusPill status={clinic.active ? "ACTIVE" : "INACTIVE"} />
                    </div>
                    {canManageSystems && (
                      <small>{accountLabels.systemScope}: {clinic.organizationName}</small>
                    )}
                    <label>
                      {text.clinic}
                      <input name="name" defaultValue={clinic.name} disabled={!canMutate} required />
                    </label>
                    <label>
                      {text.city}
                      <input name="city" defaultValue={clinic.city} disabled={!canMutate} required />
                    </label>
                    <details className="settings-clinic-advanced">
                      <summary>{accountLabels.advancedDetails}</summary>
                      <div>
                        <label>
                          {accountLabels.address}
                          <input name="address" defaultValue={clinic.address} disabled={!canMutate} required />
                        </label>
                        <label>
                          {accountLabels.phone}
                          <input name="phone" defaultValue={clinic.phone ?? ""} disabled={!canMutate} />
                        </label>
                      </div>
                    </details>
                    <div className="settings-clinic-actions">
                      <button type="submit" disabled={!canMutate}>
                        {accountLabels.saveClinic}
                      </button>
                      <button
                        form={`toggle-clinic-${clinic.id}`}
                        type="submit"
                        disabled={!canMutate}
                      >
                        {clinic.active
                          ? accountLabels.deactivateClinic
                          : accountLabels.activateClinic}
                      </button>
                    </div>
                  </form>
                  <details className="settings-chair-manager">
                    <summary>
                      <span>{chairLabels.treatmentChairs}</span>
                      <b>{clinic.chairs.filter((chair) => chair.active).length}/{clinic.chairs.length}</b>
                    </summary>
                    <form action={createChairAction} className="settings-chair-form">
                      <input name="clinicId" type="hidden" value={clinic.id} />
                      <input name="name" placeholder={chairLabels.chairName} disabled={!canMutate || !clinic.active} required />
                      <select name="specialty" defaultValue="Tổng quát" disabled={!canMutate || !clinic.active}>
                        <option value="Tổng quát">{chairLabels.general}</option>
                        <option value="Tiểu phẫu">{chairLabels.surgery}</option>
                        <option value="Chỉnh nha">{chairLabels.orthodontics}</option>
                        <option value="Implant">{chairLabels.implant}</option>
                      </select>
                      <button type="submit" disabled={!canMutate || !clinic.active}>
                        {chairLabels.addChair}
                      </button>
                    </form>
                    <div className="settings-chair-list">
                      {clinic.chairs.length > 0 ? (
                        clinic.chairs.map((chair) => (
                          <form action={updateChairAction} className="settings-chair-row" key={chair.id}>
                            <input name="chairId" type="hidden" value={chair.id} />
                            <input name="clinicId" type="hidden" value={clinic.id} />
                            <div className="settings-chair-title">
                              <strong>{chair.name}</strong>
                              <StatusPill status={chair.active ? "ACTIVE" : "INACTIVE"} />
                            </div>
                            <input name="name" defaultValue={chair.name} disabled={!canMutate} required />
                            <select name="specialty" defaultValue={chair.specialty ?? "Tổng quát"} disabled={!canMutate}>
                              <option value="Tổng quát">{chairLabels.general}</option>
                              <option value="Tiểu phẫu">{chairLabels.surgery}</option>
                              <option value="Chỉnh nha">{chairLabels.orthodontics}</option>
                              <option value="Implant">{chairLabels.implant}</option>
                            </select>
                            <button type="submit" disabled={!canMutate}>
                              {chairLabels.saveChair}
                            </button>
                            <button
                              form={`toggle-chair-${chair.id}`}
                              type="submit"
                              disabled={!canMutate}
                            >
                              {chair.active ? chairLabels.deactivateChair : chairLabels.activateChair}
                            </button>
                          </form>
                        ))
                      ) : (
                        <EmptyState label={chairLabels.noChairs} />
                      )}
                    </div>
                  </details>
                </article>
              ))}
            </div>
            {formClinics.map((clinic) => (
              <div key={`toggle-forms-${clinic.id}`}>
                <form
                  action={toggleClinicStatusAction}
                  id={`toggle-clinic-${clinic.id}`}
                  onSubmit={(event) => {
                    if (!window.confirm(confirmText.clinicStatus)) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input name="clinicId" type="hidden" value={clinic.id} />
                  <input name="active" type="hidden" value={clinic.active ? "false" : "true"} />
                </form>
                {clinic.chairs.map((chair) => (
                  <form
                    action={toggleChairStatusAction}
                    id={`toggle-chair-${chair.id}`}
                    key={chair.id}
                    onSubmit={(event) => {
                      if (!window.confirm(chairLabels.confirmChairStatus)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="chairId" type="hidden" value={chair.id} />
                    <input name="clinicId" type="hidden" value={clinic.id} />
                    <input name="active" type="hidden" value={chair.active ? "false" : "true"} />
                  </form>
                ))}
              </div>
            ))}
          </section>

          <section className="panel" data-settings-block="archive">
            <PanelHeader
              icon={Archive}
              title={accountLabels.archive}
              action={`${archiveResultCount} · ${accountLabels.archivedClinicData}`}
            />
            <div className="settings-archive-note">
              {accountLabels.archivedClinicNote}
            </div>
            <label className="settings-archive-search">
              {accountLabels.archiveSearch}
              <input
                value={settingsArchiveSearch}
                onChange={(event) => setSettingsArchiveSearch(event.target.value)}
                placeholder={accountLabels.archiveSearchPlaceholder}
              />
            </label>
            <div className="settings-archive-list">
              {filteredArchivedClinics.map((clinic) => (
                <article className="settings-archive-row" key={clinic.clinicId}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{clinic.name}</strong>
                      <span>{canManageSystems ? `${clinic.organizationName} · ${clinic.city}` : clinic.city}</span>
                    </div>
                    <StatusPill status="INACTIVE" />
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.patients}: {clinic.patientCount}</span>
                    <span>{accountLabels.appointments}: {clinic.appointmentCount}</span>
                    <span>{accountLabels.invoices}: {clinic.invoiceCount}</span>
                    <span>{accountLabels.receipts}: {clinic.receiptCount}</span>
                    <span>{accountLabels.staffAccounts}: {clinic.staffCount}</span>
                  </div>
                  <small>
                    {accountLabels.latestActivity}: {clinic.latestActivityAt ?? "-"}
                  </small>
                  <form
                    action={toggleClinicStatusAction}
                    onSubmit={(event) => {
                      if (!window.confirm(confirmText.clinicStatus)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="clinicId" type="hidden" value={clinic.clinicId} />
                    <input name="active" type="hidden" value="true" />
                    <button type="submit" disabled={!canMutate}>
                      {accountLabels.activateClinic}
                    </button>
                  </form>
                </article>
              ))}
              {archiveResultCount === 0 && <EmptyState label={accountLabels.archiveEmpty} />}
            </div>
          </section>

          <section className="panel" data-settings-block="organization">
            <PanelHeader
              icon={WalletCards}
              title={accountLabels.sourceCommission}
              action={formatVnd(sourceCommissionTotal)}
            />
            <form action={createSourceCommissionPolicyAction} className="settings-clinic-form">
              <select name="source" disabled={!canMutate}>
                {leadSourceOptions.map((source) => (
                  <option value={source.value} key={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
              <input name="name" placeholder={accountLabels.sourcePolicy} disabled={!canMutate} required />
              <input name="ownerLabel" placeholder={accountLabels.sourceOwner} disabled={!canMutate} />
              <input name="ratePercent" inputMode="decimal" placeholder={accountLabels.sourceRate} disabled={!canMutate} required />
              <input name="fixedAmount" inputMode="decimal" placeholder={accountLabels.fixedAmount} disabled={!canMutate} />
              <input name="monthlyBudget" inputMode="decimal" placeholder={accountLabels.monthlyBudget} disabled={!canMutate} />
              <button type="submit" disabled={!canMutate}>
                {accountLabels.addSourcePolicy}
              </button>
            </form>
            <form action={generateSourceCommissionAccrualsAction} className="service-action-row">
              <button type="submit" disabled={!canMutate || sourceCommission.policies.length === 0}>
                {accountLabels.generateAccruals}
              </button>
              <Link className="secondary-button" href="/settings/source-commission-export">
                {accountLabels.exportCsv}
              </Link>
            </form>
            <div className="settings-archive-list">
              {sourceCommission.policies.map((policy) => (
                <article className="settings-archive-row" key={policy.id}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{policy.source}</strong>
                      <span>{policy.name}</span>
                    </div>
                    <StatusPill status={policy.active ? "ACTIVE" : "INACTIVE"} />
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.sourceRate}: {policy.ratePercent}%</span>
                    <span>{accountLabels.fixedAmount}: {formatVnd(policy.fixedAmount)}</span>
                    <span>{accountLabels.monthlyBudget}: {policy.monthlyBudget == null ? "-" : formatVnd(policy.monthlyBudget)}</span>
                  </div>
                  <form action={toggleSourceCommissionPolicyAction}>
                    <input name="policyId" type="hidden" value={policy.id} />
                    <input name="active" type="hidden" value={policy.active ? "false" : "true"} />
                    <button type="submit" disabled={!canMutate}>
                      {policy.active ? text.deactivate : text.activate}
                    </button>
                  </form>
                </article>
              ))}
              {sourceCommission.policies.length === 0 && (
                <EmptyState label={accountLabels.sourcePolicy} />
              )}
            </div>
            <div className="record-grid">
              {sourceCommission.accruals.slice(0, 6).map((accrual) => (
                <div className="record-card" key={accrual.id}>
                  <strong>{accrual.source} · {accrual.patientName}</strong>
                  <span>{formatVnd(accrual.commissionAmount)} · {accrual.receiptNo}</span>
                  <small>{displayStatus(accrual.status, language)} · {accrual.earnedAt}</small>
                  <div className="service-action-row">
                    {accrual.status === "EARNED" && (
                      <form action={updateSourceCommissionAccrualStatusAction}>
                        <input name="accrualId" type="hidden" value={accrual.id} />
                        <input name="status" type="hidden" value="APPROVED" />
                        <button type="submit" disabled={!canMutate}>
                          {accountLabels.approve}
                        </button>
                      </form>
                    )}
                    {accrual.status === "APPROVED" && (
                      <form
                        action={updateSourceCommissionAccrualStatusAction}
                        onSubmit={(event) => {
                          if (!window.confirm(confirmText.sourceCommissionPaid)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="accrualId" type="hidden" value={accrual.id} />
                        <input name="status" type="hidden" value="PAID" />
                        <button type="submit" disabled={!canMutate}>
                          {accountLabels.markPaid}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel" data-settings-block="providers">
            <PanelHeader
              icon={Bell}
              title={accountLabels.notificationSettings}
              action={notificationSettings?.deliveryMode ?? "-"}
            />
            <div className="record-grid">
              <RecordTile
                title={accountLabels.notificationMode}
                value={notificationSettings?.deliveryMode ?? "-"}
              />
              <RecordTile
                title={accountLabels.resendFrom}
                value={notificationSettings?.resendFromEmail ?? "-"}
              />
              <RecordTile
                title={accountLabels.recentSent}
                value={String(notificationSettings?.recentSent ?? 0)}
              />
              <RecordTile
                title={accountLabels.recentFailed}
                value={String(notificationSettings?.recentFailed ?? 0)}
              />
            </div>
            <div className="settings-provider-readiness" aria-label={accountLabels.notificationProviderStatus}>
              <div className="settings-provider-readiness-head">
                <strong>{accountLabels.notificationProviderStatus}</strong>
                <span>{accountLabels.notificationProviderHint}</span>
              </div>
              <div className="settings-provider-readiness-grid">
                {notificationReadiness.map((item) => (
                  <article className="settings-provider-tile" key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                    <small>{item.status}</small>
                  </article>
                ))}
              </div>
            </div>
            <form action={sendNotificationTestAction} className="settings-clinic-form">
              <select name="channel" disabled={!canMutate} defaultValue="EMAIL">
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="ZALO">Zalo</option>
              </select>
              <input
                name="recipient"
                placeholder={accountLabels.notificationRecipient}
                disabled={!canMutate}
                required
              />
              <input
                name="subject"
                placeholder={accountLabels.notificationSubject}
                disabled={!canMutate}
              />
              <input
                name="body"
                placeholder={accountLabels.notificationBody}
                disabled={!canMutate}
              />
              <button type="submit" disabled={!canMutate}>
                {accountLabels.notificationTest}
              </button>
            </form>
          </section>

          <section className="panel" data-settings-block="providers">
            <PanelHeader
              icon={MessageSquareText}
              title={accountLabels.aiAudit}
              action={`${filteredAiRuns.length}/${aiRuns.length} · ${accountLabels.aiAuditSubtitle}`}
            />
            <div className="settings-provider-readiness settings-ai-provider-readiness" aria-label={accountLabels.aiProviderStatus}>
              <div className="settings-provider-readiness-head">
                <strong>{accountLabels.aiProviderStatus}</strong>
                <span>{accountLabels.aiProviderHint}</span>
              </div>
              <div className="settings-provider-readiness-grid">
                {aiProviderReadiness.map((item) => (
                  <article className="settings-provider-tile" key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                    <small>{item.status}</small>
                  </article>
                ))}
              </div>
              {aiSettings?.error ? <small>{aiSettings.error}</small> : null}
            </div>
            <div className="settings-clinic-form">
              <input
                value={aiAuditQuery}
                onChange={(event) => setAiAuditQuery(event.target.value)}
                placeholder={accountLabels.aiAuditSearch}
              />
              <select
                value={aiAuditModule}
                onChange={(event) => setAiAuditModule(event.target.value)}
              >
                <option value="all">{accountLabels.allModules}</option>
                {aiAuditModules.map((moduleName) => (
                  <option value={moduleName} key={moduleName}>
                    {moduleName}
                  </option>
                ))}
              </select>
              <select
                value={aiAuditStatus}
                onChange={(event) => setAiAuditStatus(event.target.value)}
              >
                <option value="all">{accountLabels.allStatuses}</option>
                <option value="SUCCEEDED">SUCCEEDED</option>
                <option value="FAILED">FAILED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
            <div className="settings-archive-list">
              {filteredAiRuns.length > 0 ? (
                filteredAiRuns.map((run) => (
                  <article className="settings-archive-row" key={run.id}>
                    <div className="settings-archive-head">
                      <div>
                        <strong>{run.module} · {run.action}</strong>
                        <span>{run.provider} / {run.model}</span>
                      </div>
                      <StatusPill status={run.status} />
                    </div>
                    <div className="settings-archive-counts">
                      <span>{run.createdAt}</span>
                      <span>{run.actor ?? "System"}</span>
                      <span>{accountLabels.aiTokens}: {run.totalTokens ?? "-"}</span>
                    </div>
                    {run.error ? <small>{run.error}</small> : null}
                  </article>
                ))
              ) : (
                <EmptyState label={accountLabels.aiAuditSubtitle} />
              )}
            </div>
          </section>

          <section className="panel" data-settings-block="governance">
            <PanelHeader icon={ShieldCheck} title={accountLabels.securityPosture} action={text.review} />
            <div className="compliance-list settings-compliance-list">
              {text.complianceItems.map((item, index) => (
                <label key={item}>
                  <input type="checkbox" defaultChecked={index < 3} readOnly />
                  {item}
                </label>
              ))}
            </div>
          </section>
        </aside>
      </section>

      {settingsSection === "governance" && (
        <>
          <section className="settings-lower-grid">
            <section className="panel">
              <PanelHeader icon={ShieldCheck} title={accountLabels.accessMatrix} action={text.staffRoles} />
              <div className="permission-list settings-permissions">
                {permissionMatrix.map((item) => (
                  <div className="permission-row settings-permission-card" key={item.role}>
                    <div>
                      <strong>{item.role}</strong>
                      <span>{item.scope}</span>
                    </div>
                    <small>{item.access}</small>
                    <div className="settings-permission-modules" aria-label={accountLabels.moduleAccess}>
                      {item.modules.map((moduleName) => (
                        <span key={`${item.role}-${moduleName}`}>{moduleName}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <PanelHeader icon={Activity} title={text.auditTrail} action={accountLabels.auditSubtitle} />
              <div className="settings-audit-list">
                {auditItems.map((item, index) => (
                  <span key={`${item}-${index}`}>{item}</span>
                ))}
              </div>
            </section>
          </section>

          <section className="panel">
            <PanelHeader
              icon={CheckCircle2}
              title={text.readiness}
              action={text.readinessAction}
            />
            <div className="record-grid">
              {text.readinessItems.map(([status, item]) => (
                <RecordTile title={status} value={item} key={`${status}-${item}`} />
              ))}
            </div>
          </section>
        </>
      )}

      {settingsModal === "staff-config" && selectedStaff && (
        <div
          aria-label={accountLabels.accountControls}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => {
            setSettingsModal(null);
            setSelectedStaffId(null);
          }}
          role="dialog"
        >
          <div
            className="progress-modal settings-staff-modal settings-staff-config-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <div>
                <span>{accountLabels.accountControls}</span>
                <h3>{selectedStaff.fullName}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => {
                  setSettingsModal(null);
                  setSelectedStaffId(null);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="settings-staff-config-summary">
              <span>{selectedStaff.email}</span>
              <span>{accountLabels.title}: {selectedStaff.title ?? accountLabels.notProvided}</span>
              <span>
                {selectedStaff.clinics.map((clinic) => clinic.name).join(", ") || text.noClinic}
              </span>
            </div>

            <div className="segmented settings-staff-config-tabs" role="tablist" aria-label={accountLabels.accountControls}>
              {!selectedStaffIsPatient && (
                <>
                  <button
                    aria-selected={staffConfigTab === "profile"}
                    className={staffConfigTab === "profile" ? "active" : ""}
                    onClick={() => setStaffConfigTab("profile")}
                    role="tab"
                    type="button"
                  >
                    {accountLabels.profileTab}
                  </button>
                  <button
                    aria-selected={staffConfigTab === "access"}
                    className={staffConfigTab === "access" ? "active" : ""}
                    onClick={() => setStaffConfigTab("access")}
                    role="tab"
                    type="button"
                  >
                    {accountLabels.accessTab}
                  </button>
                </>
              )}
              <button
                aria-selected={staffConfigTab === "security"}
                className={staffConfigTab === "security" ? "active" : ""}
                onClick={() => setStaffConfigTab("security")}
                role="tab"
                type="button"
              >
                {accountLabels.securityTab}
              </button>
            </div>

            {staffConfigTab === "profile" && !selectedStaffIsPatient && (
              <form action={updateStaffProfileAction} className="settings-staff-config-form">
                <input name="userId" type="hidden" value={selectedStaff.id} />
                <label>
                  {text.fullName}
                  <input name="fullName" defaultValue={selectedStaff.fullName} disabled={!formReady} required />
                </label>
                <label>
                  {accountLabels.phone}
                  <input name="phone" defaultValue={selectedStaff.phone ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.employeeCode}
                  <input name="employeeCode" defaultValue={selectedStaff.employeeCode ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.title}
                  <input name="title" defaultValue={selectedStaff.title ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.department}
                  <input name="department" defaultValue={selectedStaff.department ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.contractType}
                  <select name="contractType" defaultValue={selectedStaff.contractType ?? "FULL_TIME"} disabled={!formReady}>
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                    <option value="CONTRACTOR">Contractor</option>
                    <option value="INTERN">Intern</option>
                  </select>
                </label>
                <label>
                  {accountLabels.primaryClinic}
                  <select
                    name="clinicId"
                    defaultValue={selectedStaff.primaryClinicId ?? selectedStaffClinicOptions[0]?.id ?? ""}
                    disabled={!formReady}
                  >
                    <option value="">{text.noClinic}</option>
                    {selectedStaffClinicOptions.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>
                        {clinic.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {accountLabels.gender}
                  <select name="gender" defaultValue={selectedStaff.gender ?? ""} disabled={!formReady}>
                    <option value="">{accountLabels.notProvided}</option>
                    <option value="Nam">{accountLabels.male}</option>
                    <option value="Nữ">{accountLabels.female}</option>
                    <option value="Khác">{accountLabels.otherGender}</option>
                  </select>
                </label>
                <label>
                  {accountLabels.dateOfBirth}
                  <input name="dateOfBirth" type="date" defaultValue={selectedStaff.dateOfBirthIso ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.hireDate}
                  <input name="hireDate" type="date" defaultValue={selectedStaff.hireDateIso ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.salary}
                  <input name="baseSalary" inputMode="decimal" defaultValue={selectedStaff.baseSalary ?? ""} disabled={!formReady} />
                </label>
                <label>
                  {accountLabels.commissionRate}
                  <input name="commissionRate" inputMode="decimal" defaultValue={selectedStaff.commissionRate ?? ""} disabled={!formReady} />
                </label>
                <label className="settings-profile-file-field">
                  {accountLabels.profilePhoto}
                  <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!formReady} />
                </label>
                <div className="progress-modal-actions">
                  <button className="primary-button" type="submit" disabled={!formReady}>
                    {accountLabels.saveProfile}
                  </button>
                </div>
              </form>
            )}

            {staffConfigTab === "access" && !selectedStaffIsPatient && (
              <form action={updateStaffRoleAction} className="settings-staff-config-form settings-access-config-form">
                <input name="userId" type="hidden" value={selectedStaff.id} />
                <label>
                  {accountLabels.accessScope}
                  <select
                    name="assignmentClinicId"
                    defaultValue={selectedStaffAssignmentClinicId}
                    disabled={!formReady}
                  >
                    {activeFormClinics.map((clinic) => (
                      <option value={clinic.id} key={clinic.id}>
                        {clinic.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="settings-role-assignment-fieldset">
                  <legend>{accountLabels.accessRoles}</legend>
                  <div className="settings-role-checkbox-grid">
                    {staffAccountRoleOptions.map(([value, label]) => (
                      <label key={`config-${selectedStaff.id}-${value}`}>
                        <input
                          name="assignmentRole"
                          type="checkbox"
                          value={value}
                          defaultChecked={
                            selectedStaffAssignmentRoles.has(value) ||
                            (selectedStaffAssignmentRoles.size === 0 && selectedStaff.role === value)
                          }
                          disabled={!formReady}
                        />
                        <span>
                          {label}
                          <small>
                            {organizationWideRoleValues.has(value)
                              ? accountLabels.globalScope
                              : accountLabels.accessScope}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <small>{accountLabels.roleScopeHint}</small>
                </fieldset>
                <div className="progress-modal-actions">
                  <button className="primary-button" type="submit" disabled={!formReady}>
                    {text.save}
                  </button>
                </div>
              </form>
            )}

            {staffConfigTab === "security" && (
              <div className="settings-security-config">
                <div className="settings-password-state">
                  <LockKeyhole size={14} />
                  <span>
                    {selectedStaff.mustChangePassword || selectedStaff.hasPendingPasswordSetup
                      ? accountLabels.passwordPending
                      : selectedStaff.passwordChangedAt
                        ? `${accountLabels.passwordChanged}: ${selectedStaff.passwordChangedAt}`
                        : accountLabels.passwordChanged}
                  </span>
                </div>
                <div className="settings-staff-actions">
                  <form
                    action={toggleStaffStatusAction}
                    onSubmit={(event) => {
                      if (!window.confirm(confirmText.staffStatus)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="userId" type="hidden" value={selectedStaff.id} />
                    <input
                      name="active"
                      type="hidden"
                      value={selectedStaff.active ? "false" : "true"}
                    />
                    <button type="submit" disabled={!formReady}>
                      {selectedStaff.active ? text.deactivate : text.activate}
                    </button>
                  </form>
                  <form
                    action={createStaffPasswordSetupLinkAction}
                    onSubmit={(event) => {
                      if (!window.confirm(confirmText.passwordSetup)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input name="userId" type="hidden" value={selectedStaff.id} />
                    <button
                      type="submit"
                      disabled={!formReady || !selectedStaff.canCreatePasswordSetup}
                      title={
                        selectedStaff.canCreatePasswordSetup
                          ? accountLabels.createPasswordLink
                          : accountLabels.selfPasswordLinkBlocked
                      }
                    >
                      {selectedStaff.canCreatePasswordSetup
                        ? accountLabels.createPasswordLink
                        : accountLabels.selfPasswordLinkBlocked}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {settingsModal === "staff" && (
        <div
          aria-label={accountLabels.createStaffTitle}
          aria-modal="true"
          className="progress-modal-backdrop"
          onClick={() => setSettingsModal(null)}
          role="dialog"
        >
          <form
            action={createStaffAction}
            className="progress-modal settings-staff-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setSettingsModal(null)}
          >
            <div className="progress-modal-header">
              <div>
                <span>{text.admin}</span>
                <h3>{accountLabels.createStaffTitle}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsModal(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="progress-modal-grid modal-form-grid">
              <label>
                {text.fullName}
                <input name="fullName" disabled={!staffCreateReady} required />
              </label>
              <label>
                {text.email}
                <input name="email" type="email" disabled={!staffCreateReady} required />
              </label>
              <label>
                {accountLabels.title}
                <input name="title" disabled={!staffCreateReady} />
              </label>
              <label>
                {text.clinic}
                <select name="clinicId" disabled={!staffCreateReady} required>
                  {activeFormClinics.map((clinic) => (
                    <option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="settings-role-assignment-fieldset">
                <legend>{accountLabels.accessRoles}</legend>
                <div className="settings-role-checkbox-grid">
                  {staffAccountRoleOptions.map(([value, label]) => (
                    <label key={`create-${value}`}>
                      <input
                        name="assignmentRole"
                        type="checkbox"
                        value={value}
                        defaultChecked={value === "FRONT_DESK"}
                        disabled={!staffCreateReady}
                      />
                      <span>
                        {label}
                        <small>
                          {organizationWideRoleValues.has(value)
                            ? accountLabels.globalScope
                            : accountLabels.accessScope}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setSettingsModal(null)}>
                {accountLabels.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!staffCreateReady}>
                <UsersRound size={16} />
                {text.createStaff}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}


"use client";
import { getAccountLabels } from "./settings-copy";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useAppLanguage } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { type AppRole } from "@/lib/permissions";
import type { SettingsWorkspace } from "@/lib/settings-types";
import { settingsText, roleText, auditTrail, useNoticeText, normalizeSearchText, sourceCommissionSourceOptions } from "./settings-shared";
export function useSettingsPanelModel({ settingsWorkspace, }: {
    settingsWorkspace?: SettingsWorkspace | null;
    role: string;
    clinicCount: number;
}) {
    const { language } = useAppLanguage();
    const text = settingsText[language];
    const searchParams = useSearchParams();
    const router = useRouter();
    const requestedSettingsSection = searchParams.get("section");
    const initialSettingsSection = requestedSettingsSection &&
        ["accounts", "organization", "archive", "providers", "governance"].includes(requestedSettingsSection)
        ? (requestedSettingsSection as "accounts" | "organization" | "archive" | "providers" | "governance")
        : "accounts";
    const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
    const [settingsModal, setSettingsModal] = useState<"staff" | "staff-config" | null>(null);
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
    const [staffConfigTab, setStaffConfigTab] = useState<"profile" | "access" | "security">("profile");
    const [settingsSection, setSettingsSection] = useState<"accounts" | "organization" | "archive" | "providers" | "governance">(initialSettingsSection);
    const selectSettingsSection = (section: "accounts" | "organization" | "archive" | "providers" | "governance") => {
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
        return normalizeSearchText([
            run.module,
            run.action,
            run.provider,
            run.model,
            run.status,
            run.actor ?? "",
            run.error ?? "",
        ].join(" ")).includes(normalizedAiAuditQuery);
    });
    const sourceCommissionTotal = sourceCommission.accruals.reduce((total, accrual) => total + accrual.commissionAmount, 0);
    const leadSourceOptions = sourceCommissionSourceOptions(language);
    const staff = settingsWorkspace?.staff ?? [];
    const [staffSearch, setStaffSearch] = useState("");
    const [staffRoleFilter, setStaffRoleFilter] = useState<AppRole | "all">("all");
    const auditItems = settingsWorkspace?.auditLogs.map((log) => `${log.createdAt} - ${log.actor} - ${log.action} (${log.entityType})`) ?? auditTrail;
    const roleOptions = Object.entries(roleText[language]) as Array<[
        AppRole,
        string
    ]>;
    const staffAccountRoleOptions = roleOptions.filter(([value]) => value !== "PATIENT");
    const organizationWideRoleValues = new Set<AppRole>(["OWNER", "AREA_MANAGER"]);
    const formReady = Boolean(canMutate && formClinics.length > 0);
    const staffCreateReady = Boolean(canMutate && activeFormClinics.length > 0);
    const activeStaff = staff.filter((member) => member.active);
    const pendingPasswordStaff = staff.filter((member) => member.mustChangePassword || member.hasPendingPasswordSetup);
    const ownerStaff = staff.filter((member) => member.role === "OWNER" && member.active);
    const staffSearchQuery = normalizeSearchText(staffSearch);
    const filteredStaff = staff.filter((member) => {
        if (staffRoleFilter !== "all" &&
            member.role !== staffRoleFilter &&
            !member.roleAssignments.some((assignment) => assignment.role === staffRoleFilter)) {
            return false;
        }
        if (!staffSearchQuery) {
            return true;
        }
        return normalizeSearchText([
            member.fullName,
            member.email,
            member.phone,
            member.employeeCode,
            member.title,
            member.department,
            member.roleAssignments.map((assignment) => roleText[language][assignment.role]).join(" "),
            member.clinics.map((clinic) => clinic.name).join(" "),
        ].join(" ")).includes(staffSearchQuery);
    });
    const systemOwnerAccounts = filteredStaff.filter((member) => member.role === "OWNER");
    const areaManagerAccounts = filteredStaff.filter((member) => member.role === "AREA_MANAGER");
    const managerAccounts = filteredStaff.filter((member) => member.role === "CLINIC_MANAGER");
    const operatorAccounts = filteredStaff.filter((member) => member.role !== "OWNER" &&
        member.role !== "AREA_MANAGER" &&
        member.role !== "CLINIC_MANAGER" &&
        member.role !== "PATIENT");
    const patientAccounts = filteredStaff.filter((member) => member.role === "PATIENT");
    const archiveSearchQuery = normalizeSearchText(settingsArchiveSearch);
    const filteredArchivedClinics = archivedClinics.filter((clinic) => {
        if (!archiveSearchQuery) {
            return true;
        }
        return normalizeSearchText([
            clinic.name,
            clinic.organizationName,
            clinic.city,
            clinic.latestActivityAt ?? "",
            String(clinic.patientCount),
            String(clinic.appointmentCount),
            String(clinic.invoiceCount),
            String(clinic.receiptCount),
            String(clinic.staffCount),
        ].join(" ")).includes(archiveSearchQuery);
    });
    const archiveResultCount = filteredArchivedClinics.length;
    const staffGroups = [
        {
            key: "system",
            title: language === "vi" ? "Chủ hệ thống" : "System owners",
            description: language === "vi"
                ? "Quyền cao nhất toàn tổ chức, cấu hình hệ thống, dữ liệu và tài chính."
                : "Highest organization-level access for system, data, and finance settings.",
            members: systemOwnerAccounts,
        },
        {
            key: "area",
            title: language === "vi" ? "Quản lý khu vực" : "Area managers",
            description: language === "vi"
                ? "Quản lý nhiều chi nhánh trong phạm vi hệ thống được giao."
                : "Manages multiple assigned branches inside the system.",
            members: areaManagerAccounts,
        },
        {
            key: "managers",
            title: language === "vi" ? "Quản lý phòng khám" : "Clinic managers",
            description: language === "vi"
                ? "Quản lý chi nhánh, lịch hẹn, bệnh nhân, thu tiền, báo cáo và nhân sự tại phạm vi được giao."
                : "Manages assigned branches, schedule, patients, collections, reports, and local staff.",
            members: managerAccounts,
        },
        {
            key: "staff",
            title: language === "vi" ? "Nhân sự" : "Staff",
            description: language === "vi"
                ? "Bác sĩ, lễ tân, billing và các vai trò vận hành hằng ngày."
                : "Dentists, front desk, billing, and day-to-day operating roles.",
            members: operatorAccounts,
        },
        {
            key: "patients",
            title: language === "vi" ? "Bệnh nhân" : "Patients",
            description: language === "vi"
                ? "Tài khoản portal của bệnh nhân. Hồ sơ hành chính vẫn quản lý trong module Bệnh nhân."
                : "Patient portal accounts. Administrative profile data stays in the Patients module.",
            members: patientAccounts,
        },
    ];
    const settingsSections = language === "vi"
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
    const permissionMatrix = language === "vi"
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
    const notificationReadiness = language === "vi"
        ? [
            {
                label: "Chế độ hiện tại",
                value: notificationMode,
                status: notificationMode === "disabled"
                    ? "Cần cấu hình"
                    : notificationMode === "log" || notificationMode === "demo"
                        ? "Chỉ ghi log"
                        : "Sẵn sàng gửi",
            },
            {
                label: "Email Resend",
                value: notificationSettings?.resendFromEmail ?? "Chưa cấu hình",
                status: notificationMode === "resend" && notificationSettings?.resendFromEmail
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
                status: notificationMode === "disabled"
                    ? "Needs config"
                    : notificationMode === "log" || notificationMode === "demo"
                        ? "Log only"
                        : "Delivery ready",
            },
            {
                label: "Resend email",
                value: notificationSettings?.resendFromEmail ?? "Not configured",
                status: notificationMode === "resend" && notificationSettings?.resendFromEmail
                    ? "Ready"
                    : "Unused",
            },
            {
                label: "SMS/Zalo/Email webhook",
                value: "Uses channel env vars or fallback URL",
                status: notificationMode === "webhook" ? "Enabled" : "Unused",
            },
        ];
    const aiProviderReadiness = language === "vi"
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
    const confirmText = language === "vi"
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
    const chairLabels = language === "vi"
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
    const accountLabels = getAccountLabels({ language });
    const selectedStaff = selectedStaffId
        ? staff.find((member) => member.id === selectedStaffId) ?? null
        : null;
    const selectedStaffIsPatient = selectedStaff?.role === "PATIENT";
    const selectedStaffClinicOptions = selectedStaff
        ? selectedStaff.clinics.filter((clinic) => clinic.active).length > 0
            ? selectedStaff.clinics.filter((clinic) => clinic.active)
            : activeFormClinics
        : activeFormClinics;
    const selectedStaffAssignments = selectedStaff?.roleAssignments.filter((assignment) => assignment.active) ?? [];
    const selectedStaffAssignmentRoles = new Set(selectedStaffAssignments.map((assignment) => assignment.role));
    const selectedStaffAssignmentClinicId = selectedStaffAssignments.find((assignment) => assignment.clinicId)?.clinicId ??
        selectedStaff?.primaryClinicId ??
        selectedStaff?.clinics[0]?.id ??
        activeFormClinics[0]?.id ??
        "";
    return { settingsWorkspace, language, text, notice, settingsModal, setSettingsModal, setSelectedStaffId, staffConfigTab, setStaffConfigTab, settingsSection, selectSettingsSection, settingsArchiveSearch, setSettingsArchiveSearch, setupEmail, canMutate, canManageSystems, formClinics, activeFormClinics, organizations, notificationSettings, aiSettings, sourceCommission, aiRuns, aiAuditQuery, setAiAuditQuery, aiAuditStatus, setAiAuditStatus, aiAuditModule, setAiAuditModule, aiAuditModules, filteredAiRuns, sourceCommissionTotal, leadSourceOptions, staff, staffSearch, setStaffSearch, staffRoleFilter, setStaffRoleFilter, auditItems, roleOptions, staffAccountRoleOptions, organizationWideRoleValues, formReady, staffCreateReady, activeStaff, pendingPasswordStaff, ownerStaff, filteredStaff, filteredArchivedClinics, archiveResultCount, staffGroups, settingsSections, roleCounts, permissionMatrix, notificationMode, notificationReadiness, aiProviderReadiness, confirmText, chairLabels, accountLabels, selectedStaff, selectedStaffIsPatient, selectedStaffClinicOptions, selectedStaffAssignmentRoles, selectedStaffAssignmentClinicId };
}
export type SettingsPanelModel = ReturnType<typeof useSettingsPanelModel>;

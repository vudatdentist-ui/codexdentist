"use client";

import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  PanelRightOpen,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Wallet,
  X,
  UsersRound,
  WalletCards,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chatModuleWithAiAction } from "@/app/(app)/ai/actions";
import {
  LanguageContext,
  useAppLanguage,
  type Language,
} from "@/components/AppLanguage";
import {
  AppSidebar,
  AppTopbar,
  ModuleAiFloatingShell,
  type AppShellNavGroup,
} from "@/components/AppShell";
import { type Appointment, type Patient } from "@/lib/data";
import {
  accessibleViews,
  roleLabels,
  viewRoutes,
  type AppRole,
  type ViewKey,
} from "@/lib/permissions";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { PatientPortalWorkspace } from "@/lib/patient-portal-types";
import type { PatientFilesWorkspace } from "@/lib/patient-files-types";
import type { PharmacyWorkspace } from "@/lib/pharmacy-types";
import type { CrmWorkspace } from "@/lib/crm-types";
import type { InventoryWorkspace } from "@/lib/inventory-types";
import type { JourneyRecordsWorkspace } from "@/lib/journey-records-types";
import type { LearningWorkspace } from "@/lib/learning-types";
import type { StaffPayrollWorkspace } from "@/lib/payroll-types";
import type { FormsWorkspace } from "@/lib/forms-types";
import type { ReportsWorkspace } from "@/lib/reports-types";
import type { ScheduleWorkspace } from "@/lib/schedule-types";
import type { ServicesWorkspace } from "@/lib/services-types";
import type { SettingsWorkspace } from "@/lib/settings-types";
import type { AppSession } from "@/lib/session";
import type { AccountingWorkspace } from "@/lib/accounting-types";
import type { ModuleAiRunSummary } from "@/lib/ai-runs-types";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { ClinicalWorkspace as ClinicalWorkspaceData } from "@/lib/clinical-types";
import type { CommunityWorkspace as CommunityWorkspaceData } from "@/lib/community-types";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { TreatmentWorkspace } from "@/lib/treatment-types";
import type { TaskInboxWorkspace } from "@/lib/task-inbox-types";
import {
  EmptyState,
  StatusPill as BaseStatusPill,
} from "@/components/suite-primitives";

const Dashboard = dynamic(() =>
  import("@/modules/dashboard/Dashboard").then((module) => module.Dashboard),
);
const ScheduleBoard = dynamic(() =>
  import("@/modules/schedule/ScheduleBoard").then((module) => module.ScheduleBoard),
);
const PatientsPanel = dynamic(() =>
  import("@/modules/patients/PatientsPanel").then((module) => module.PatientsPanel),
);
const PatientJourneyPanel = dynamic(() =>
  import("@/modules/journey/PatientJourneyPanel").then(
    (module) => module.PatientJourneyPanel,
  ),
);
const BillingPanel = dynamic(() =>
  import("@/modules/billing/BillingPanel").then((module) => module.BillingPanel),
);
const AccountingPanel = dynamic(() =>
  import("@/modules/accounting/AccountingPanel").then(
    (module) => module.AccountingPanel,
  ),
);
const CrmPanel = dynamic(() =>
  import("@/modules/crm/CrmPanel").then((module) => module.CrmPanel),
);
const ReportsPanel = dynamic(() =>
  import("@/modules/reports/ReportsPanel").then((module) => module.ReportsPanel),
);
const CommunityPanel = dynamic(() =>
  import("@/modules/community/CommunityPanel").then(
    (module) => module.CommunityPanel,
  ),
);
const PatientAppPanel = dynamic(() =>
  import("@/modules/patient-app/PatientAppPanel").then(
    (module) => module.PatientAppPanel,
  ),
);
const EmployeeAppPanel = dynamic(() =>
  import("@/modules/employee-app/EmployeeAppPanel").then(
    (module) => module.EmployeeAppPanel,
  ),
);
const ServicesPanel = dynamic(() =>
  import("@/modules/services/ServicesPanel").then((module) => module.ServicesPanel),
);
const PharmacyPanel = dynamic(() =>
  import("@/modules/pharmacy/PharmacyPanel").then((module) => module.PharmacyPanel),
);
const FormsPanel = dynamic(() =>
  import("@/modules/forms/FormsPanel").then((module) => module.FormsPanel),
);
const InventoryPanel = dynamic(() =>
  import("@/modules/inventory/InventoryPanel").then(
    (module) => module.InventoryPanel,
  ),
);
const LearningPanel = dynamic(() =>
  import("@/modules/learning/LearningPanel").then((module) => module.LearningPanel),
);
const StaffPayrollPanel = dynamic(() =>
  import("@/modules/staff/StaffPayrollPanel").then(
    (module) => module.StaffPayrollPanel,
  ),
);
const SettingsPanel = dynamic(() =>
  import("@/modules/settings/SettingsPanel").then((module) => module.SettingsPanel),
);

const navGroups: AppShellNavGroup[] = [
  {
    title: { vi: "Tổng quan", en: "Overview" },
    items: [
      { key: "dashboard", icon: LayoutDashboard },
      { key: "reports", icon: BarChart3 },
      { key: "accounting", icon: WalletCards },
    ],
  },
  {
    title: { vi: "Bệnh nhân", en: "Patients" },
    items: [
      { key: "schedule", icon: CalendarDays },
      { key: "patients", icon: UsersRound },
      { key: "journey", icon: Stethoscope },
      { key: "billing", icon: CreditCard },
      { key: "crm", icon: Inbox },
      { key: "patient-app", icon: Smartphone },
    ],
  },
  {
    title: { vi: "Lâm sàng", en: "Clinical" },
    items: [
      { key: "services", icon: ClipboardList },
      { key: "pharmacy", icon: FileText },
      { key: "forms", icon: ShieldCheck },
    ],
  },
  {
    title: { vi: "Nội bộ", en: "Internal" },
    items: [
      { key: "staff", icon: Building2 },
      { key: "employee-app", icon: Smartphone },
      { key: "learning", icon: Bell },
      { key: "community", icon: MessageSquareText },
    ],
  },
  {
    title: { vi: "Kho", en: "Stock" },
    items: [{ key: "inventory", icon: ClipboardList }],
  },
  {
    title: { vi: "Hệ thống", en: "System" },
    items: [{ key: "settings", icon: Settings }],
  },
];

const languageStorageKey = "nhavista.language";
const chainScopeStorageKey = "codexmed.chainScope";
const actionScrollStorageKey = "codexmed.actionScroll";

type UiText = {
  allClinics: string;
  allChains: string;
  allPatients: string;
  chainScope: string;
  clinicScope: string;
  databaseLive: string;
  demoMode: string;
  inbox: string;
  language: string;
  nav: Record<ViewKey, string>;
  roles: Record<AppRole, string>;
  clearSearch: string;
  patientSearchPlaceholder: string;
  searchPlaceholder: string;
  selectPatient: string;
  signOut: string;
  titles: Record<ViewKey, string>;
  topbarEyebrow: string;
};

const uiText: Record<Language, UiText> = {
  vi: {
    allClinics: "Tất cả phòng khám",
    allChains: "Tất cả chuỗi",
    allPatients: "Tất cả bệnh nhân",
    chainScope: "Phạm vi chuỗi",
    clinicScope: "Phạm vi phòng khám",
    databaseLive: "",
    demoMode: "",
    inbox: "Hộp thư",
    language: "Ngôn ngữ",
    clearSearch: "Xóa tìm kiếm",
    patientSearchPlaceholder: "Tìm bệnh nhân, số điện thoại, mã bệnh nhân",
    nav: {
      dashboard: "Tổng quan",
      schedule: "Lịch hẹn",
      patients: "Bệnh nhân",
      journey: "Hành trình điều trị",
      clinical: "Lâm sàng",
      treatment: "Điều trị",
      billing: "Thanh toán",
      accounting: "Kế toán",
      services: "Quản lý dịch vụ",
      staff: "Nhân sự",
      crm: "CSKH",
      inventory: "Kho vật tư",
      pharmacy: "Đơn thuốc",
      forms: "Biểu mẫu",
      learning: "Đào tạo",
      "employee-app": "Ứng dụng nhân viên",
      reports: "Báo cáo",
      community: "Cộng đồng",
      "patient-app": "Ứng dụng bệnh nhân",
      settings: "Cài đặt",
    },
    roles: {
      OWNER: "Chủ hệ thống",
      AREA_MANAGER: "Quản lý khu vực",
      CLINIC_MANAGER: "Quản lý phòng khám",
      DENTIST: "Nha sĩ",
      HYGIENIST: "Điều dưỡng nha khoa",
      FRONT_DESK: "Lễ tân",
      BILLING: "Thu ngân",
      PATIENT: "Bệnh nhân",
    },
    searchPlaceholder: "Tìm bệnh nhân, số điện thoại, hóa đơn",
    selectPatient: "Chọn bệnh nhân",
    signOut: "Đăng xuất",
    titles: {
      dashboard: "Tổng quan hệ thống",
      schedule: "Lịch hẹn đa phòng khám",
      patients: "Hồ sơ bệnh nhân 360",
      journey: "Hành trình bệnh nhân",
      clinical: "Không gian lâm sàng tại ghế",
      treatment: "Kế hoạch điều trị",
      billing: "Thanh toán và công nợ",
      accounting: "Kế toán quản trị",
      services: "Quản lý dịch vụ",
      staff: "Nhân sự và chấm công",
      crm: "Chăm sóc khách hàng",
      inventory: "Thiết bị và vật tư tiêu hao",
      pharmacy: "Đơn thuốc và thư viện thuốc",
      forms: "Biểu mẫu và phiếu đồng thuận",
      learning: "Thư viện số và khóa học",
      "employee-app": "Ứng dụng nhân viên",
      reports: "Báo cáo",
      community: "Cộng đồng nội bộ",
      "patient-app": "Cổng thông tin bệnh nhân",
      settings: "Vai trò và tuân thủ",
    },
    topbarEyebrow: "Vận hành chuỗi nha khoa tại Việt Nam",
  },
  en: {
    allClinics: "All clinics",
    allChains: "All chains",
    allPatients: "All patients",
    chainScope: "Chain scope",
    clinicScope: "Clinic scope",
    databaseLive: "",
    demoMode: "",
    inbox: "Inbox",
    language: "Language",
    clearSearch: "Clear search",
    patientSearchPlaceholder: "Search patient, phone, patient code",
    nav: {
      dashboard: "Dashboard",
      schedule: "Schedule",
      patients: "Patients",
      journey: "Patient Journey",
      clinical: "Clinical",
      treatment: "Treatment",
      billing: "Billing",
      accounting: "Accounting",
      services: "Services",
      staff: "Staff",
      crm: "CRM",
      inventory: "Inventory",
      pharmacy: "Pharmacy",
      forms: "Forms",
      learning: "Learning",
      "employee-app": "Staff App",
      reports: "Reports",
      community: "Community",
      "patient-app": "Patient App",
      settings: "Settings",
    },
    roles: roleLabels,
    searchPlaceholder: "Search patient, phone, invoice",
    selectPatient: "Select patient",
    signOut: "Sign out",
    titles: {
      dashboard: "Group dashboard",
      schedule: "Multi-clinic schedule",
      patients: "Patient 360",
      journey: "Patient journey",
      clinical: "Chairside clinical workspace",
      treatment: "Treatment plans",
      billing: "Billing and collections",
      accounting: "Management accounting",
      services: "Service management",
      staff: "Staff and time clock",
      crm: "Customer care",
      inventory: "Equipment and supplies",
      pharmacy: "Prescriptions and drug library",
      forms: "Forms and consent library",
      learning: "Digital library and courses",
      "employee-app": "Staff mobile app",
      reports: "Reports",
      community: "Internal community",
      "patient-app": "Patient portal and mobile",
      settings: "Roles and compliance",
    },
    topbarEyebrow: "Viet Nam multi-clinic operations",
  },
};

const workspaceText = {
  vi: {
    dashboard: {
      appSurfaces: "Các bề mặt ứng dụng",
      chairUtilization: "Hiệu suất ghế",
      chairs: "ghế",
      clinicPerformance: "Hiệu suất phòng khám",
      collected: "Đã thu",
      compare: "So sánh",
      doctors: "bác sĩ",
      liveAppointmentFlow: "Luồng lịch hẹn hôm nay",
      open: "Mở",
      production: "Doanh thu",
      roadmap: "Lộ trình",
      surfaces: [
        {
          title: "Quản trị chuỗi",
          text: "Chủ hệ thống và quản lý theo dõi chi nhánh, doanh thu, nhân sự, quyền truy cập và xu hướng vận hành.",
        },
        {
          title: "Ứng dụng nhân sự phòng khám",
          text: "Lễ tân, bác sĩ, phụ tá và thu ngân vận hành lịch hẹn, bệnh án và thanh toán hằng ngày.",
        },
        {
          title: "Ứng dụng bệnh nhân",
          text: "Bệnh nhân đặt lịch, điền biểu mẫu, duyệt kế hoạch, thanh toán và nhận chăm sóc sau điều trị.",
        },
      ],
      todayVisits: "Lượt hẹn hôm nay",
      visits: "lượt hẹn",
    },
    schedule: {
      arrive: "Đã đến",
      available: "Trống",
      badRelation: "Bệnh nhân, bác sĩ hoặc ghế không thuộc phòng khám đã chọn.",
      booking: "Tạo lịch hẹn",
      cancel: "Hủy",
      chair: "Ghế",
      chairMap: "Sơ đồ ghế",
      chairs: "ghế",
      clinic: "Phòng khám",
      createBooking: "Tạo lịch hẹn",
      date: "Ngày",
      day: "Ngày",
      done: "Hoàn tất",
      duration: "Phút",
      inChair: "Lên ghế",
      patient: "Bệnh nhân",
      provider: "Bác sĩ",
      reason: "Lý do khám",
      reasonPlaceholder: "Khám, lấy cao răng, tư vấn implant",
      scheduleView: "Chế độ xem lịch",
      start: "Bắt đầu",
      time: "Giờ",
      today: "Hôm nay",
      utilized: "hiệu suất",
      week: "Tuần",
    },
    patients: {
      activePlanProgress: "tiến độ kế hoạch đang điều trị",
      address: "Địa chỉ",
      age: "Tuổi",
      balance: "Công nợ",
      chart: "Sơ đồ răng",
      clinic: "Phòng khám",
      consent: "Đồng ý",
      consentChannel: "Kênh",
      consentHistory: "Lịch sử đồng ý",
      consentRecorded: "Ghi nhận",
      consentSigned: "Đã ký",
      consentVersion: "Phiên bản",
      createPatient: "Tạo bệnh nhân",
      dob: "Ngày sinh",
      duplicateContactWarning: "Có bệnh nhân đang dùng thông tin liên hệ này:",
      email: "Email",
      editProfile: "Sửa hồ sơ",
      empty: "Không có bệnh nhân trong phạm vi phòng khám này",
      female: "Nữ",
      frontDesk: "Lễ tân",
      gender: "Giới tính",
      grantConsent: "Đồng ý xử lý dữ liệu",
      guardian: "Người giám hộ",
      heading: "Tạo mới, cập nhật và quản lý đồng ý",
      lastVisit: "Lần khám gần nhất",
      live: "Đang hoạt động",
      leadSource: "Nguồn khách",
      leadSourceGovernance: "Kiểm soát nguồn khách",
      leadSourceReason: "Lý do đổi nguồn",
      leadSourceReasonPlaceholder: "Ví dụ: đối soát cuộc gọi, sai nguồn khi nhập nhanh...",
      leadSourceLocked: "Nguồn khách được khóa audit; chỉ quản lý được đổi và phải nhập lý do.",
      saveLeadSource: "Cập nhật nguồn",
      medicalAlerts: "Cảnh báo y khoa",
      medicalAlertsPlaceholder: "Dị ứng, bệnh nền, lưu ý điều trị",
      male: "Nam",
      nationalId: "CMND/CCCD",
      needsRenewal: "Cần gia hạn",
      newPatient: "Bệnh nhân mới",
      nextVisit: "Lịch hẹn tiếp theo",
      noConsentDate: "chưa ghi nhận",
      openBilling: "Mở thanh toán",
      openJourney: "Mở bệnh án",
      openSchedule: "Mở lịch hẹn",
      operationSummary: "Tổng quan vận hành",
      patientRegistry: "Danh sách bệnh nhân",
      phone: "Điện thoại",
      profile: "Hồ sơ bệnh nhân",
      quickActions: "Thao tác tiếp theo",
      registry: "Danh bạ bệnh nhân",
      saveProfile: "Lưu hồ sơ",
      treatmentProgress: "Tiến độ điều trị",
      unknown: "Chưa rõ",
      visitReason: "Lý do đến khám",
      visitReasonPlaceholder: "Ví dụ: đau răng, khám định kỳ, tư vấn niềng răng...",
      fullName: "Họ tên",
    },
    reports: {
      aging: "Tuổi nợ",
      amount: "Số tiền",
      completed: "hoàn tất",
      collected: "đã thu",
      collection: "Thu tiền",
      collectionRatio: "Tỷ lệ thu",
      communityPosts: "Bài nội bộ",
      consentRenewals: "Đồng ý cần gia hạn",
      count: "Số lượng",
      daily: "Hằng ngày",
      close: "Đóng",
      details: "Chi tiết",
      drilldown: "Phân tích chi tiết",
      filter: "Lọc báo cáo",
      from: "Từ ngày",
      exportCsv: "Xuất CSV",
      generated: "Cập nhật",
      generatedDemo: "Demo",
      heading: "Hiệu suất phòng khám và tín hiệu rủi ro",
      live: "Live",
      monthToDate: "Tháng hiện tại",
      newPatients: "Bệnh nhân mới",
      noData: "Chưa có dữ liệu trong phạm vi này",
      open: "còn mở",
      openBalance: "Công nợ mở",
      operationalReporting: "Báo cáo vận hành",
      operationalCaveat:
        "Số liệu phục vụ điều hành nội bộ; không thay thế báo cáo kế toán, thuế hoặc kiểm toán.",
      operationalSignals: "Tín hiệu vận hành",
      overdue: "quá hạn",
      overdueInvoices: "Hóa đơn quá hạn",
      period: "Kỳ báo cáo",
      production: "Doanh thu",
      productionByClinic: "Doanh thu theo phòng khám",
      providerPerformance: "Hiệu suất bác sĩ",
      reportTable: "Bảng báo cáo phòng khám",
      sourceRevenue: "Doanh thu theo nguồn",
      sourceCost: "Chi phí nguồn",
      sourceRoi: "ROI",
      sourceDrilldown: "Nguồn",
      commissionDue: "Hoa hồng phải trả",
      serviceMix: "Cơ cấu dịch vụ",
      serviceDrilldown: "Dịch vụ",
      sourceMix: "Nguồn bệnh nhân",
      providerDrilldown: "Bác sĩ",
      trend: "Xu hướng 7 ngày",
      todayVisits: "Lượt hẹn hôm nay",
      to: "Đến ngày",
      visits: "lượt hẹn",
    },
    community: {
      addComment: "Thêm bình luận",
      allClinics: "Tất cả phòng khám",
      announcement: "Thông báo",
      body: "Nội dung",
      bodyPlaceholder: "Viết cập nhật, quyết định cần chốt hoặc checklist.",
      caseDiscussion: "Thảo luận ca",
      clinic: "Phòng khám",
      delete: "Xóa",
      deleteConfirm: "Xóa bài đăng nội bộ này? Các bình luận trong bài cũng sẽ bị xóa.",
      heading: "Câu hỏi lâm sàng, bàn giao, thông báo",
      internalCommunity: "Cộng đồng nội bộ",
      newPost: "Bài đăng mới",
      policy: "Chính sách",
      publish: "Đăng",
      replies: "phản hồi",
      reply: "Trả lời",
      share: "Chia sẻ",
      shiftHandoff: "Bàn giao ca",
      tags: "Thẻ",
      tagsPlaceholder: "implant, bàn giao, tái khám",
      title: "Tiêu đề",
      titlePlaceholder: "Bàn giao, hỏi ca, thông báo",
      training: "Đào tạo",
      type: "Loại",
    },
    portal: {
      acceptPlan: "Đồng ý kế hoạch",
      appointments: "Lịch hẹn",
      balance: "Công nợ",
      confirm: "Xác nhận",
      consent: "Đồng ý",
      dataTitle: "Dữ liệu cổng bệnh nhân",
      emptyPatient: "Chưa liên kết hồ sơ bệnh nhân",
      heading: "Lịch hẹn, điều trị, đồng ý, thanh toán",
      mobileAria: "Xem trước ứng dụng bệnh nhân",
      mobileFlow: "Luồng ứng dụng bệnh nhân",
      notLinked: "Chưa liên kết",
      openInvoices: "Hóa đơn mở",
      patient: "Bệnh nhân",
      patientPortal: "Cổng bệnh nhân",
      pay: "Thanh toán",
      synced: "Đã đồng bộ",
      treatmentPlan: "Kế hoạch điều trị",
      treatmentPlans: "Kế hoạch điều trị",
      unknown: "Chưa rõ",
      greeting: "Chào",
      noAppointmentPrefix: "Hồ sơ của bạn đang hoạt động tại",
    },
    settings: {
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
        ["Nha sĩ", "Đội điều trị", "Bệnh án, ghi chú, chỉ định, kế hoạch"],
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
  },
  en: {
    dashboard: {
      appSurfaces: "Three app surfaces",
      chairUtilization: "Chair utilization",
      chairs: "chairs",
      clinicPerformance: "Clinic performance",
      collected: "Collected",
      compare: "Compare",
      doctors: "doctors",
      liveAppointmentFlow: "Live appointment flow",
      open: "Open",
      production: "Production",
      roadmap: "Roadmap",
      surfaces: [
        {
          title: "SaaS admin",
          text: "Owners and managers see every branch, revenue, staffing, access, and performance trend.",
        },
        {
          title: "Clinic staff app",
          text: "Front desk, dentists, assistants, and billing run the daily schedule and patient record.",
        },
        {
          title: "Patient mobile",
          text: "Patients book visits, complete forms, approve plans, pay, and receive post-op care.",
        },
      ],
      todayVisits: "Today's visits",
      visits: "visits",
    },
    schedule: {
      arrive: "Arrive",
      available: "Available",
      badRelation: "Patient, provider, or chair does not match the selected clinic.",
      booking: "New booking",
      cancel: "Cancel",
      chair: "Chair",
      chairMap: "Chair map",
      chairs: "chairs",
      clinic: "Clinic",
      createBooking: "Create booking",
      date: "Date",
      day: "Day",
      done: "Done",
      duration: "Minutes",
      inChair: "In chair",
      patient: "Patient",
      provider: "Provider",
      reason: "Reason",
      reasonPlaceholder: "Exam, cleaning, implant consult",
      scheduleView: "Schedule view",
      start: "Start",
      time: "Time",
      today: "Today",
      utilized: "utilized",
      week: "Week",
    },
    patients: {
      activePlanProgress: "active plan progress",
      address: "Address",
      age: "Age",
      balance: "Balance",
      chart: "Dental chart",
      clinic: "Clinic",
      consent: "Consent",
      consentChannel: "Channel",
      consentHistory: "Consent history",
      consentRecorded: "Recorded",
      consentSigned: "Signed",
      consentVersion: "Version",
      createPatient: "Create patient",
      dob: "Date of birth",
      duplicateContactWarning: "A patient already uses this contact:",
      email: "Email",
      editProfile: "Edit profile",
      empty: "No patients in this clinic scope",
      female: "Female",
      frontDesk: "Front desk",
      gender: "Gender",
      grantConsent: "Grant consent",
      guardian: "Guardian",
      heading: "Create, update, and consent",
      lastVisit: "Last visit",
      live: "Live",
      leadSource: "Lead source",
      leadSourceGovernance: "Lead source governance",
      leadSourceReason: "Reason for source change",
      leadSourceReasonPlaceholder: "Example: call audit, incorrect quick-entry source...",
      leadSourceLocked: "Lead source is audit-locked; only managers can change it with a reason.",
      saveLeadSource: "Update source",
      medicalAlerts: "Medical alerts",
      medicalAlertsPlaceholder: "Allergy, condition, treatment note",
      male: "Male",
      nationalId: "National ID",
      needsRenewal: "Needs renewal",
      newPatient: "New patient",
      nextVisit: "Next visit",
      noConsentDate: "not recorded",
      openBilling: "Open billing",
      openJourney: "Open chart",
      openSchedule: "Open schedule",
      operationSummary: "Operational summary",
      patientRegistry: "Patient registry",
      phone: "Phone",
      profile: "Patient profile",
      quickActions: "Next actions",
      registry: "Patient registry",
      saveProfile: "Save profile",
      treatmentProgress: "Treatment progress",
      unknown: "Unknown",
      visitReason: "Visit reason",
      visitReasonPlaceholder: "Example: tooth pain, routine checkup, orthodontic consult...",
      fullName: "Full name",
    },
    reports: {
      aging: "A/R aging",
      amount: "Amount",
      completed: "completed",
      collected: "collected",
      collection: "Collection",
      collectionRatio: "Collection ratio",
      communityPosts: "Community posts",
      consentRenewals: "Consent renewals",
      count: "Count",
      daily: "Daily",
      close: "Close",
      details: "Details",
      drilldown: "Drilldown",
      filter: "Filter report",
      from: "From",
      exportCsv: "Export CSV",
      generated: "Updated",
      generatedDemo: "Demo",
      heading: "Clinic performance and risk signals",
      live: "Live",
      monthToDate: "Month to date",
      newPatients: "New patients",
      noData: "No data in this scope",
      open: "open",
      openBalance: "Open balance",
      operationalReporting: "Operational reporting",
      operationalCaveat:
        "Operational management metrics only; not a substitute for accounting, tax, or audited financial reports.",
      operationalSignals: "Operational signals",
      overdue: "overdue",
      overdueInvoices: "Overdue invoices",
      period: "Reporting period",
      production: "Production",
      productionByClinic: "Production by clinic",
      providerPerformance: "Provider performance",
      reportTable: "Clinic report table",
      sourceRevenue: "Revenue by source",
      sourceCost: "Source cost",
      sourceRoi: "ROI",
      sourceDrilldown: "Source",
      commissionDue: "Commission due",
      serviceMix: "Service mix",
      serviceDrilldown: "Service",
      sourceMix: "Patient source mix",
      providerDrilldown: "Provider",
      trend: "7-day trend",
      todayVisits: "Today's visits",
      to: "To",
      visits: "visits",
    },
    community: {
      addComment: "Add a comment",
      allClinics: "All clinics",
      announcement: "Announcement",
      body: "Body",
      bodyPlaceholder: "Write the update, decision needed, or checklist.",
      caseDiscussion: "Case discussion",
      clinic: "Clinic",
      delete: "Delete",
      deleteConfirm: "Delete this internal post? Comments on the post will also be deleted.",
      heading: "Clinical questions, handoffs, announcements",
      internalCommunity: "Internal community",
      newPost: "New post",
      policy: "Policy",
      publish: "Publish",
      replies: "replies",
      reply: "Reply",
      share: "Share",
      shiftHandoff: "Shift handoff",
      tags: "Tags",
      tagsPlaceholder: "implant, handoff, recall",
      title: "Title",
      titlePlaceholder: "Handoff, case question, announcement",
      training: "Training",
      type: "Type",
    },
    portal: {
      acceptPlan: "Accept plan",
      appointments: "Appointments",
      balance: "Balance",
      confirm: "Confirm",
      consent: "Consent",
      dataTitle: "Patient portal data",
      emptyPatient: "No linked patient profile",
      heading: "Appointments, treatment, consent, payments",
      mobileAria: "Patient mobile app preview",
      mobileFlow: "Patient mobile flow",
      notLinked: "Not linked",
      openInvoices: "Open invoices",
      patient: "Patient",
      patientPortal: "Patient portal",
      pay: "Pay",
      synced: "Synced",
      treatmentPlan: "Treatment plan",
      treatmentPlans: "Treatment plans",
      unknown: "Unknown",
      greeting: "Hi",
      noAppointmentPrefix: "Your profile is active at",
    },
    settings: {
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
  },
} as const;

const statusText: Record<Language, Record<string, string>> = {
  vi: {
    "Active": "Đang hoạt động",
    "Inactive": "Ngừng hoạt động",
    "Accepted": "Đã chấp nhận",
    "All": "Tất cả",
    "Arrived": "Đã đến",
    "Billing": "Thanh toán",
    "Cancelled": "Đã hủy",
    "Clinical": "Khám",
    "Comment": "Bình luận",
    "Completed": "Hoàn tất",
    "Completed (100%)": "Hoàn tất (100%)",
    "Confirmed": "Đã xác nhận",
    "Declined": "Từ chối",
    "Draft": "Nháp",
    "File": "Tệp",
    "Files": "Hồ sơ",
    "Granted": "Đã đồng ý",
    "In chair": "Đang trên ghế",
    "In progress": "Đang thực hiện",
    "In Progress": "Đang thực hiện",
    "Locked": "Đã khóa",
    "No show": "Không đến",
    "None": "Không có",
    "Needs renewal": "Cần gia hạn",
    "Open": "Đang mở",
    "Overdue": "Quá hạn",
    "Paid": "Đã thanh toán",
    "Partial": "Thanh toán một phần",
    "Plan": "Kế hoạch",
    "Planned": "Đã lên kế hoạch",
    "Planned (0%)": "Đã lên kế hoạch (0%)",
    "Presented": "Đã trình bày",
    "Requested": "Đã yêu cầu",
    "Session": "Buổi hẹn",
    "Step 1 (20%)": "Bước 1 (20%)",
    "Step 2 (40%)": "Bước 2 (40%)",
    "Step 3 (55%)": "Bước 3 (55%)",
    "Step 4 (70%)": "Bước 4 (70%)",
    "Treatment": "Điều trị",
    "Void": "Đã hủy",
    "NEW": "Mới",
    "CONTACTED": "Đã liên hệ",
    "CONSULT_BOOKED": "Đã hẹn tư vấn",
    "VISITED": "Đã đến",
    "CONVERTED": "Đã chuyển đổi",
    "LOST": "Mất lead",
    "RECALL": "Recall",
    "CALL": "Gọi điện",
    "ZALO": "Zalo",
    "SMS": "SMS",
    "EMAIL": "Email",
    "NOTE": "Ghi chú",
    "TASK": "Công việc",
    "FOLLOW_UP": "Chăm sóc tiếp",
    "PHONE": "Điện thoại",
    "IN_APP": "Trong app",
    "PUSH": "Push",
    "PURCHASE": "Nhập mua",
    "CONSUMPTION": "Tiêu hao",
    "WASTE": "Hủy/hỏng",
    "TRANSFER_IN": "Chuyển vào",
    "TRANSFER_OUT": "Chuyển ra",
    "RETURN": "Hoàn trả",
    "SCHEDULED": "Đã xếp ca",
    "APPROVED": "Đã duyệt",
    "PAID": "Đã chi trả",
    "EARNED": "Đã phát sinh",
    "REQUESTED": "Đã yêu cầu",
    "REJECTED": "Từ chối",
    "CLOSED": "Đã đóng",
    "NORMAL": "Bình thường",
    "ASSIGNED": "Đã giao",
    "IN_PROGRESS": "Đang học",
    "COMPLETED": "Hoàn tất",
    "BOOK": "Sách",
    "ARTICLE": "Bài viết",
    "VIDEO": "Video",
    "COURSE": "Khóa học",
    "CHECKLIST": "Checklist",
    "POLICY": "Quy trình",
    "ORDERED": "Đã đặt",
    "RECEIVED": "Đã nhận",
    "LOW_STOCK": "Sắp hết",
    "DRAFT": "Nháp",
    "PUBLISHED": "Đã xuất bản",
    "SIGNED": "Đã ký",
    "DISPENSED": "Đã cấp thuốc",
    "SENT": "Đã gửi",
    "FAILED": "Lỗi gửi",
    "EXPIRED": "Hết hạn",
    "VOID": "Đã hủy",
    "CANCELLED": "Đã hủy",
    "INVOICE": "Hóa đơn",
    "PAYMENT": "Thanh toán",
    "RECEIPT": "Phiếu thu",
    "CREDIT_BALANCE": "Tiền dư",
    "crm": "CSKH",
    "billing": "Thanh toán",
    "inventory": "Kho",
    "hr": "Nhân sự",
    "schedule": "Lịch hẹn",
    "learning": "Đào tạo",
    "notification": "Thông báo",
    "high": "Cao",
    "medium": "Vừa",
    "low": "Thấp",
    "OPEN": "Đang mở",
    "DONE": "Hoàn tất",
    "ACTIVE": "Đang hoạt động",
    "INACTIVE": "Ngừng hoạt động",
    "MAINTENANCE": "Đang bảo trì",
    "RETIRED": "Ngừng sử dụng",
    "PARTIAL": "Một phần",
    "OK": "Trong ngưỡng",
    "WATCH": "Cần theo dõi",
    "OVER": "Vượt ngưỡng",
    "INFO": "Thông tin",
    "INCOME": "Thu",
    "EXPENSE": "Chi",
    "TRANSFER": "Chuyển khoản",
    "critical": "Nghiêm trọng",
    "watch": "Cần theo dõi",
    "info": "Thông tin",
  },
  en: {},
};

function displayStatus(status: string, language: Language) {
  return statusText[language][status] ?? status;
}

type JourneyReceiptMethod = "cash" | "card" | "bank_transfer";

type JourneyReceipt = {
  id: string;
  serviceId: string;
  patientId: string;
  patient: string;
  clinicId: string;
  amount: number;
  method: JourneyReceiptMethod;
  collectedAt: number;
};

function initialLanguage(): Language {
  return "vi";
}

function saveActionScrollState(pathname: string) {
  const workspace = document.querySelector<HTMLElement>(".workspace");
  window.sessionStorage.setItem(
    actionScrollStorageKey,
    JSON.stringify({
      pathname,
      time: Date.now(),
      windowX: window.scrollX,
      windowY: window.scrollY,
      workspaceTop: workspace?.scrollTop ?? 0,
    }),
  );
}

function restoreActionScrollState(pathname: string) {
  const raw = window.sessionStorage.getItem(actionScrollStorageKey);

  if (!raw) {
    return;
  }

  try {
    const saved = JSON.parse(raw) as {
      pathname?: string;
      time?: number;
      windowX?: number;
      windowY?: number;
      workspaceTop?: number;
    };

    if (
      saved.pathname !== pathname ||
      !saved.time ||
      Date.now() - saved.time > 30_000
    ) {
      return;
    }

    const workspace = document.querySelector<HTMLElement>(".workspace");
    window.scrollTo(saved.windowX ?? 0, saved.windowY ?? 0);

    if (workspace) {
      workspace.scrollTop = saved.workspaceTop ?? 0;
    }
  } catch {
    window.sessionStorage.removeItem(actionScrollStorageKey);
  }
}

function shouldKeepActionNotice(notice: string) {
  if (notice === "module-ai-ready" || notice === "module-ai-failed") {
    return true;
  }

  return /denied|missing|bad|invalid|not-found|unavailable|database|conflict|exists|empty|locked|failed|error|expired/i.test(
    notice,
  );
}

export function DentalSuite({
  activeView,
  accountingWorkspace,
  billingWorkspace,
  clinicalWorkspace,
  communityWorkspace,
  crmWorkspace,
  dashboardWorkspace,
  formsWorkspace,
  inventoryWorkspace,
  journeyRecordsWorkspace,
  learningWorkspace,
  moduleAiRuns,
  patientFilesWorkspace,
  patientPortalWorkspace,
  patientWorkspace,
  pharmacyWorkspace,
  reportsWorkspace,
  scheduleWorkspace,
  servicesWorkspace,
  settingsWorkspace,
  session,
  staffPayrollWorkspace,
  taskInboxWorkspace,
  treatmentWorkspace,
}: {
  activeView: ViewKey;
  accountingWorkspace?: AccountingWorkspace | null;
  billingWorkspace?: BillingWorkspace | null;
  clinicalWorkspace?: ClinicalWorkspaceData | null;
  communityWorkspace?: CommunityWorkspaceData | null;
  crmWorkspace?: CrmWorkspace | null;
  dashboardWorkspace?: DashboardWorkspace | null;
  formsWorkspace?: FormsWorkspace | null;
  inventoryWorkspace?: InventoryWorkspace | null;
  journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
  learningWorkspace?: LearningWorkspace | null;
  moduleAiRuns?: ModuleAiRunSummary[];
  patientFilesWorkspace?: PatientFilesWorkspace | null;
  patientPortalWorkspace?: PatientPortalWorkspace | null;
  patientWorkspace?: PatientWorkspace | null;
  pharmacyWorkspace?: PharmacyWorkspace | null;
  reportsWorkspace?: ReportsWorkspace | null;
  scheduleWorkspace?: ScheduleWorkspace | null;
  servicesWorkspace?: ServicesWorkspace | null;
  settingsWorkspace?: SettingsWorkspace | null;
  session: AppSession;
  staffPayrollWorkspace?: StaffPayrollWorkspace | null;
  taskInboxWorkspace?: TaskInboxWorkspace | null;
  treatmentWorkspace?: TreatmentWorkspace | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const routeSearchParams = useSearchParams();
  const routeSearchParamString = routeSearchParams.toString();
  const requestedPatientId = routeSearchParams.get("patientId") ?? "";
  const requestedPatientRouteKey = `${activeView}:${requestedPatientId}`;
  const [appliedRoutePatientId, setAppliedRoutePatientId] = useState("");
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [languageLoaded, setLanguageLoaded] = useState(false);
  const t = uiText[language];
  const [journeyChartSearch, setJourneyChartSearch] = useState("");
  const [billingSearch, setBillingSearch] = useState("");
  const [patientLookupSearch, setPatientLookupSearch] = useState("");
  const [patientFilterId, setPatientFilterId] = useState("all");
  const [chainScopeId, setChainScopeId] = useState("all");
  const [journeySelectedPatientId, setJourneySelectedPatientId] = useState("");
  const [journeyPatientMenuOpen, setJourneyPatientMenuOpen] = useState(false);
  const [
    journeySearchShowsSelectedPatientLabel,
    setJourneySearchShowsSelectedPatientLabel,
  ] = useState(true);
  const moduleAiNotice = routeSearchParams.get("notice");
  const showModuleAiResult =
    moduleAiNotice === "module-ai-ready" || moduleAiNotice === "module-ai-failed";
  const [moduleAiModalOpen, setModuleAiModalOpen] = useState(showModuleAiResult);
  const journeyReceipts: JourneyReceipt[] = [];
  const journeyInvoiceIds = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    const saveFromEvent = (event: Event) => {
      const target = event.target;

      if (
        target instanceof HTMLFormElement ||
        (target instanceof HTMLElement && target.closest("form"))
      ) {
        saveActionScrollState(pathname);
      }
    };

    document.addEventListener("submit", saveFromEvent, true);
    document.addEventListener("change", saveFromEvent, true);
    document.addEventListener("click", saveFromEvent, true);

    return () => {
      document.removeEventListener("submit", saveFromEvent, true);
      document.removeEventListener("change", saveFromEvent, true);
      document.removeEventListener("click", saveFromEvent, true);
    };
  }, [pathname]);

  useLayoutEffect(() => {
    restoreActionScrollState(pathname);
    const animationFrame = window.requestAnimationFrame(() =>
      restoreActionScrollState(pathname),
    );
    const timeout = window.setTimeout(() => restoreActionScrollState(pathname), 160);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [pathname, routeSearchParamString]);

  useEffect(() => {
    const notice = routeSearchParams.get("notice");

    if (!notice || shouldKeepActionNotice(notice)) {
      return;
    }

    const nextParams = new URLSearchParams(routeSearchParamString);
    nextParams.delete("notice");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [pathname, routeSearchParams, routeSearchParamString, router]);

  useEffect(() => {
    const storedLanguage =
      window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "vi";

    setLanguage(storedLanguage);
    setChainScopeId(window.localStorage.getItem(chainScopeStorageKey) || "all");
    setLanguageLoaded(true);
  }, []);

  useEffect(() => {
    if (!languageLoaded) {
      return;
    }

    window.localStorage.setItem(languageStorageKey, language);
  }, [language, languageLoaded]);

  useEffect(() => {
    if (!languageLoaded) {
      return;
    }

    window.localStorage.setItem(chainScopeStorageKey, chainScopeId);
  }, [chainScopeId, languageLoaded]);

  useEffect(() => {
    if (showModuleAiResult) {
      setModuleAiModalOpen(true);
    }
  }, [showModuleAiResult]);

  const sessionClinics = useMemo(
    () =>
      session.clinics.map((clinic) => ({
        ...clinic,
        chainId: null,
        chainName: null,
        chairs: 0,
        doctors: 0,
        todayVisits: 0,
        utilization: 0,
        production: 0,
        collection: 0,
        pendingClaims: 0,
      })),
    [session.clinics],
  );

  const availableClinics = useMemo(() => {
    const allowedClinicIds = new Set(session.clinicIds);
    const clinicSource =
      patientWorkspace?.clinics ??
      scheduleWorkspace?.clinics ??
      settingsWorkspace?.clinics.map((clinic) => ({
        ...clinic,
        chairs: 0,
        doctors: 0,
        todayVisits: 0,
        utilization: 0,
        production: 0,
        collection: 0,
        pendingClaims: 0,
      })) ??
      sessionClinics;

    return clinicSource.filter((clinic) => allowedClinicIds.has(clinic.id));
  }, [
    patientWorkspace?.clinics,
    scheduleWorkspace?.clinics,
    settingsWorkspace?.clinics,
    session.clinicIds,
    sessionClinics,
  ]);

  const chainOptions = useMemo(() => {
    const fromSettings =
      settingsWorkspace?.chains
        .filter((chain) => chain.active)
        .map((chain) => ({ id: chain.id, name: chain.name })) ?? [];
    const chains = new Map(fromSettings.map((chain) => [chain.id, chain.name]));

    for (const clinic of availableClinics) {
      if (clinic.chainId) {
        chains.set(clinic.chainId, clinic.chainName ?? chains.get(clinic.chainId) ?? clinic.chainId);
      }
    }

    return Array.from(chains, ([id, name]) => ({ id, name })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [availableClinics, settingsWorkspace?.chains]);

  useEffect(() => {
    if (
      chainScopeId !== "all" &&
      !chainOptions.some((chain) => chain.id === chainScopeId)
    ) {
      setChainScopeId("all");
    }
  }, [chainOptions, chainScopeId]);

  const permittedViews = useMemo(
    () => new Set(accessibleViews(session)),
    [session.role],
  );

  const visibleClinics = useMemo(
    () =>
      chainScopeId === "all"
        ? availableClinics
        : availableClinics.filter((clinic) => clinic.chainId === chainScopeId),
    [availableClinics, chainScopeId],
  );

  const visibleClinicIds = useMemo(
    () => new Set(visibleClinics.map((clinic) => clinic.id)),
    [visibleClinics],
  );

  const appointmentSource = scheduleWorkspace?.appointments ?? [];
  const visibleAppointments = useMemo(
    () =>
      appointmentSource.filter((appointment) =>
        visibleClinicIds.has(appointment.clinicId),
      ),
    [appointmentSource, visibleClinicIds],
  );
  const patientSource = patientWorkspace?.patients ?? clinicalWorkspace?.patients ?? [];
  const visiblePatients = useMemo(
    () =>
      patientWorkspace || clinicalWorkspace
        ? patientSource
        : patientSource.filter((patient) => visibleClinicIds.has(patient.clinicId)),
    [clinicalWorkspace, patientSource, patientWorkspace, visibleClinicIds],
  );
  const schedulePatientById = useMemo(() => {
    const patients = new Map<string, PatientSearchRecord>();

    for (const patient of visiblePatients) {
      patients.set(patient.id, patient);
    }

    for (const patient of scheduleWorkspace?.patients ?? []) {
      if (!patients.has(patient.id)) {
        patients.set(patient.id, patient);
      }
    }

    return patients;
  }, [scheduleWorkspace?.patients, visiblePatients]);
  const usesJourneyControls =
    activeView === "journey" || activeView === "clinical" || activeView === "treatment";
  const usesSharedPatientFilter =
    activeView === "schedule" || activeView === "patients" || activeView === "billing";
  const hasTopbarControls = usesJourneyControls || usesSharedPatientFilter;
  const exactPatientFilter =
    usesSharedPatientFilter &&
    patientFilterId !== "all" &&
    visiblePatients.some((patient) => patient.id === patientFilterId)
      ? patientFilterId
      : "";
  const exactPatient = exactPatientFilter
    ? visiblePatients.find((patient) => patient.id === exactPatientFilter)
    : undefined;
  const journeyChartSearchQuery = normalizeSearchText(journeyChartSearch.trim());
  const billingTopbarSearchQuery = normalizeSearchText(billingSearch.trim());
  const patientLookupSearchQuery = normalizeSearchText(patientLookupSearch.trim());
  const journeySelectedPatient =
    visiblePatients.find((patient) => patient.id === journeySelectedPatientId) ?? null;
  const journeyPatientSearchMatches = patientSearchMatches(
    visiblePatients,
    journeyChartSearchQuery,
  );

  const selectJourneyPatient = (patient: PatientSearchRecord) => {
    setJourneySelectedPatientId(patient.id);
    setJourneyChartSearch("");
    setJourneySearchShowsSelectedPatientLabel(true);
    router.push(`/journey?patientId=${encodeURIComponent(patient.id)}`);
  };

  const openPatientRoute = (view: "patients" | "billing", patientId: string) => {
    setJourneyPatientMenuOpen(false);
    router.push(`/${view}?patientId=${encodeURIComponent(patientId)}`);
  };
  const billingPatientSearchMatches = patientSearchMatches(
    visiblePatients,
    billingTopbarSearchQuery,
  );
  const billingSelectedPatient =
    patientFilterId === "all"
    ? undefined
    : visiblePatients.find((patient) => patient.id === patientFilterId);
  const patientLookupSearchMatches = patientSearchMatches(
    visiblePatients,
    patientLookupSearchQuery,
  );
  const selectedSharedPatient =
    patientFilterId === "all"
    ? undefined
    : visiblePatients.find((patient) => patient.id === patientFilterId);
  const treatmentSource = treatmentWorkspace?.plans ?? [];
  const visiblePlans = useMemo(
    () =>
      treatmentWorkspace
        ? treatmentSource
        : treatmentSource.filter((plan) => visibleClinicIds.has(plan.clinicId)),
    [treatmentSource, treatmentWorkspace, visibleClinicIds],
  );
  const invoiceSource = billingWorkspace?.invoices ?? [];
  const visibleInvoices = useMemo(
    () => invoiceSource.filter((invoice) => visibleClinicIds.has(invoice.clinicId)),
    [invoiceSource, visibleClinicIds],
  );
  const patientScopedPatients = exactPatientFilter
    ? visiblePatients.filter((patient) => patient.id === exactPatientFilter)
    : visiblePatients;
  const patientScopedAppointments = exactPatientFilter
    ? visibleAppointments.filter((appointment) => appointment.patientId === exactPatientFilter)
    : visibleAppointments;
  const scheduleScopedAppointments =
    activeView === "schedule" && patientLookupSearchQuery
      ? patientScopedAppointments.filter((appointment) => {
          const patient = schedulePatientById.get(appointment.patientId);

          return matchesChartSearch(patientLookupSearchQuery, [
            appointment.patient,
            appointment.provider,
            appointment.procedure,
            appointment.room,
            appointment.status,
            appointment.time,
            patient?.name,
            patient?.phone,
            patient ? patientCodeFor(patient) : null,
            patient?.email,
            patient?.nationalId,
            patient?.address,
          ]);
        })
      : patientScopedAppointments;
  const patientScopedInvoices = exactPatientFilter
    ? visibleInvoices.filter(
        (invoice) =>
          invoice.patientId === exactPatientFilter ||
          (exactPatient && invoice.patient === exactPatient.name),
      )
    : visibleInvoices;
  const createJourneyReceipt = (_receipt: JourneyReceipt) => {};
  const updateJourneyInvoiceAmount = (_invoiceId: string, _amount: number) => {};
  const recordJourneyInvoicePayment = (_invoiceId: string, _amount: number) => {};
  const voidJourneyInvoiceIfUnpaid = (_invoiceId: string) => {};
  const voidJourneyInvoice = (_invoiceId: string) => {};
  const issueJourneyInvoiceForService = (_input: {
    clinicId: string;
    patient: string;
    patientId: string;
    amount: number;
    creditAllocationId?: string;
    invoiceId?: string;
    issuedAt?: number;
    receiptId?: string;
    serviceCode?: string;
    serviceId: string;
    paidAmountOverride?: number;
  }) => "";

  useEffect(() => {
    if (visiblePatients.length === 0) {
      if (journeySelectedPatientId) {
        setJourneySelectedPatientId("");
        setJourneySearchShowsSelectedPatientLabel(false);
      }

      return;
    }

    if (
      usesJourneyControls &&
      requestedPatientRouteKey !== appliedRoutePatientId &&
      visiblePatients.some((patient) => patient.id === requestedPatientId)
    ) {
      setAppliedRoutePatientId(requestedPatientRouteKey);
      setJourneySelectedPatientId(requestedPatientId);
      setJourneyChartSearch("");
      setJourneySearchShowsSelectedPatientLabel(true);
      return;
    }

    if (
      journeySelectedPatientId &&
      !visiblePatients.some((patient) => patient.id === journeySelectedPatientId)
    ) {
      setJourneySelectedPatientId("");
      setJourneySearchShowsSelectedPatientLabel(false);
    }
  }, [
    appliedRoutePatientId,
    journeySelectedPatientId,
    requestedPatientId,
    requestedPatientRouteKey,
    usesJourneyControls,
    visiblePatients,
  ]);

  useEffect(() => {
    if (
      usesSharedPatientFilter &&
      requestedPatientRouteKey !== appliedRoutePatientId &&
      visiblePatients.some((patient) => patient.id === requestedPatientId)
    ) {
      setAppliedRoutePatientId(requestedPatientRouteKey);
      setPatientFilterId(requestedPatientId);
      setBillingSearch("");
      setPatientLookupSearch("");
      return;
    }

    if (
      patientFilterId !== "all" &&
      !visiblePatients.some((patient) => patient.id === patientFilterId)
    ) {
      setPatientFilterId("all");
    }
  }, [
    appliedRoutePatientId,
    patientFilterId,
    requestedPatientId,
    requestedPatientRouteKey,
    usesSharedPatientFilter,
    visiblePatients,
  ]);

  const production = visibleClinics.reduce(
    (total, clinic) => total + clinic.production,
    0,
  );
  const collection = visibleClinics.reduce(
    (total, clinic) => total + clinic.collection,
    0,
  );
  const todayVisits = visibleClinics.reduce(
    (total, clinic) => total + clinic.todayVisits,
    0,
  );
  const utilization = Math.round(
    visibleClinics.reduce((total, clinic) => total + clinic.utilization, 0) /
      Math.max(visibleClinics.length, 1),
  );
  const latestModuleAiRun = moduleAiRuns?.[0] ?? null;
  const latestModuleAiOutput = moduleAiOutput(latestModuleAiRun?.output);
  const moduleAiSupported =
    session.role !== "PATIENT";
  const moduleAiContextJson = useMemo(
    () => {
      const context = buildModuleAiContext({
          activeView,
          accountingWorkspace,
          billingWorkspace,
          clinicalWorkspace,
          communityWorkspace,
          crmWorkspace,
          dashboardWorkspace,
          formsWorkspace,
          inventoryWorkspace,
          journeySelectedPatient,
          journeyRecordsWorkspace,
          learningWorkspace,
          patientFilesWorkspace,
          patientPortalWorkspace,
          patientWorkspace,
          pharmacyWorkspace,
          reportsWorkspace,
          scheduleWorkspace,
          servicesWorkspace,
          settingsWorkspace,
          staffPayrollWorkspace,
          taskInboxWorkspace,
          treatmentWorkspace,
        });

      return stringifyAiContext(context);
    },
    [
      activeView,
      accountingWorkspace,
      billingWorkspace,
      clinicalWorkspace,
      communityWorkspace,
      crmWorkspace,
      dashboardWorkspace,
      formsWorkspace,
      inventoryWorkspace,
      journeySelectedPatient,
      journeyRecordsWorkspace,
      learningWorkspace,
      patientFilesWorkspace,
      patientPortalWorkspace,
      patientWorkspace,
      pharmacyWorkspace,
      reportsWorkspace,
      scheduleWorkspace,
      servicesWorkspace,
      settingsWorkspace,
      staffPayrollWorkspace,
      taskInboxWorkspace,
      treatmentWorkspace,
    ],
  );
  const moduleAiText =
    language === "vi"
      ? {
          action: "Gửi task cho AI",
          answerReady: "Kết quả gần nhất",
          caveats: "Giới hạn",
          close: "Đóng",
          empty: "Nhập task cụ thể để AI phân tích mục đang mở.",
          failed: "Lần gọi AI gần nhất bị lỗi",
          history: "Lịch sử gần đây",
          open: "Mở AI",
          patientContext: "Ngữ cảnh bệnh nhân",
          placeholder:
            "Ví dụ: Tìm 3 điểm bất thường, giải thích nguyên nhân có thể và đề xuất việc cần làm.",
          prompt: "Task muốn giao cho AI",
          suggestedActions: "Việc nên làm",
          suggestionOnly: "AI chỉ đưa gợi ý và không tự ghi dữ liệu vào hệ thống.",
          takeaways: "Điểm chính",
          title: "CodexMed AI",
          tokens: "tokens",
        }
      : {
          action: "Send task to AI",
          answerReady: "Latest result",
          caveats: "Caveats",
          close: "Close",
          empty: "Enter a specific task for AI to analyze the current module.",
          failed: "Latest AI call failed",
          history: "Recent history",
          open: "Open AI",
          patientContext: "Patient context",
          placeholder:
            "Example: Find 3 anomalies, explain possible causes, and suggest next actions.",
          prompt: "Task for AI",
          suggestedActions: "Suggested actions",
          suggestionOnly: "AI provides suggestions only and does not write data to the system.",
          takeaways: "Takeaways",
          title: "CodexMed AI",
          tokens: "tokens",
        };
  const moduleAiMeta =
    latestModuleAiRun?.totalTokens
      ? `${latestModuleAiRun.model} · ${latestModuleAiRun.totalTokens} tokens`
      : latestModuleAiRun?.model ?? "";

  return (
    <LanguageContext.Provider value={{ language, t }}>
      <div className="app-shell">
      <AppSidebar
        activeView={activeView}
        language={language}
        navGroups={navGroups}
        navLabels={t.nav}
        permittedViews={permittedViews}
      />

      <main className="workspace">
        <AppTopbar
          activeLanguage={language}
          alertsLabel="Alerts"
          allChainsLabel={t.allChains}
          chainOptions={chainOptions}
          chainScopeId={chainScopeId}
          chainScopeLabel={t.chainScope}
          currentPath={viewRoutes[activeView]}
          eyebrow={t.topbarEyebrow}
          inboxLabel={t.inbox}
          languageLabel={t.language}
          notificationWorkspace={taskInboxWorkspace}
          onChainScopeChange={(value) => {
            setChainScopeId(value);
            setPatientFilterId("all");
          }}
          onLanguageChange={setLanguage}
          organizationName={session.organizationName}
          roleLabel={t.roles[session.role]}
          signOutLabel={t.signOut}
          title={titleFor(activeView, language)}
          userName={session.fullName}
        >
          {hasTopbarControls && (
          <div className="topbar-controls">
            {usesJourneyControls ? (
              <>
                <button
                  className="secondary-button journey-patient-menu-trigger"
                  type="button"
                  onClick={() => setJourneyPatientMenuOpen(true)}
                >
                  <PanelRightOpen size={16} aria-hidden="true" />
                  {journeyTopbarText[language].patientMenu}
                </button>
                <PatientSearchCombobox
                  query={journeyChartSearch}
                  onQueryChange={(value) => {
                    setJourneyChartSearch(value);
                    setJourneySearchShowsSelectedPatientLabel(value.length > 0);
                  }}
                  matches={journeyPatientSearchMatches}
                  selectedPatient={journeySelectedPatient ?? undefined}
                  showSelectedPatientLabel={journeySearchShowsSelectedPatientLabel}
                  placeholder={journeyTopbarText[language].searchPlaceholder}
                  selectLabel={journeyTopbarText[language].selectPatient}
                  noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"}
                  onSelect={selectJourneyPatient}
                />
                {(journeyChartSearch ||
                  (journeySelectedPatient && journeySearchShowsSelectedPatientLabel)) && (
                  <button
                    className="chart-clear-search topbar-clear-search"
                    type="button"
                    onClick={() => {
                      setJourneyChartSearch("");
                      setJourneySearchShowsSelectedPatientLabel(false);
                    }}
                  >
                    {journeyTopbarText[language].clearSearch}
                  </button>
                )}
                <JourneyPatientMenu
                  appointments={visibleAppointments}
                  billingWorkspace={billingWorkspace}
                  clinics={visibleClinics}
                  language={language}
                  onClose={() => setJourneyPatientMenuOpen(false)}
                  onOpenBilling={(patientId) => openPatientRoute("billing", patientId)}
                  onOpenProfile={(patientId) => openPatientRoute("patients", patientId)}
                  onSelect={(patient) => {
                    selectJourneyPatient(patient);
                    setJourneyPatientMenuOpen(false);
                  }}
                  open={journeyPatientMenuOpen}
                  patients={visiblePatients}
                  selectedPatientId={journeySelectedPatient?.id ?? ""}
                />
              </>
            ) : activeView === "billing" ? (
              <>
                <PatientSearchCombobox
                  query={billingSearch}
                  onQueryChange={(value) => {
                    setBillingSearch(value);
                    setPatientFilterId("all");
                  }}
                  matches={billingPatientSearchMatches}
                  selectedPatient={billingSelectedPatient}
                  placeholder={billingTopbarText[language].searchPlaceholder}
                  selectLabel={t.selectPatient}
                  noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"}
                  onSelect={(patient) => {
                    setPatientFilterId(patient.id);
                    setBillingSearch("");
                  }}
                />
                {(billingSearch || patientFilterId !== "all") && (
                  <button
                    className="chart-clear-search topbar-clear-search"
                    type="button"
                    onClick={() => {
                      setBillingSearch("");
                      setPatientFilterId("all");
                    }}
                  >
                    {billingTopbarText[language].clearSearch}
                  </button>
                )}
              </>
            ) : (
              <>
                <PatientSearchCombobox
                  query={patientLookupSearch}
                  onQueryChange={(value) => {
                    setPatientLookupSearch(value);
                    setPatientFilterId("all");
                  }}
                  matches={patientLookupSearchMatches}
                  selectedPatient={selectedSharedPatient}
                  placeholder={t.patientSearchPlaceholder}
                  selectLabel={t.selectPatient}
                  noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"}
                  onSelect={(patient) => {
                    setPatientFilterId(patient.id);
                    setPatientLookupSearch("");
                  }}
                />
                {(patientLookupSearch || patientFilterId !== "all") && (
                  <button
                    className="chart-clear-search topbar-clear-search"
                    type="button"
                    onClick={() => {
                      setPatientLookupSearch("");
                      setPatientFilterId("all");
                    }}
                  >
                    {t.clearSearch}
                  </button>
                )}
              </>
            )}
          </div>
          )}
        </AppTopbar>

        {moduleAiSupported && (
          <ModuleAiFloatingShell
            closeLabel={moduleAiText.close}
            isOpen={moduleAiModalOpen}
            moduleTitle={moduleAiText.title}
            onClose={() => setModuleAiModalOpen(false)}
            onOpen={() => setModuleAiModalOpen(true)}
            openLabel={moduleAiText.open}
            routeTitle={titleFor(activeView, language)}
          >
            {moduleAiModalOpen ? (
              <>
              <form action={chatModuleWithAiAction} className="module-ai-chat-form">
                <input name="module" type="hidden" value={activeView} />
                <input name="contextJson" type="hidden" value={moduleAiContextJson} />
                <input
                  name="selectedPatientId"
                  type="hidden"
                  value={usesJourneyControls ? journeySelectedPatient?.id ?? "" : ""}
                />
                <input
                  name="selectedPatientName"
                  type="hidden"
                  value={usesJourneyControls ? journeySelectedPatient?.name ?? "" : ""}
                />
                <p className="module-ai-note">{moduleAiText.suggestionOnly}</p>
                {usesJourneyControls && journeySelectedPatient ? (
                  <p className="module-ai-note">
                    {moduleAiText.patientContext}: {patientSearchDisplayLabel(journeySelectedPatient)}
                  </p>
                ) : null}
                <label>
                  {moduleAiText.prompt}
                  <textarea
                    name="task"
                    placeholder={moduleAiText.placeholder}
                    rows={4}
                    maxLength={1200}
                    required
                  />
                </label>
                <div className="accounting-ai-action">
                  <button className="primary-button compact-button" type="submit">
                    <MessageSquareText size={16} />
                    {moduleAiText.action}
                  </button>
                  {moduleAiMeta && <span>{moduleAiMeta}</span>}
                </div>
              </form>
              {showModuleAiResult && latestModuleAiRun?.status === "FAILED" ? (
                <div className="schedule-alert accounting-warning">
                  {moduleAiText.failed}
                  {latestModuleAiRun.error ? `: ${latestModuleAiRun.error}` : ""}
                </div>
              ) : showModuleAiResult && latestModuleAiOutput ? (
                <div className="accounting-ai-result">
                  <p>{latestModuleAiOutput.answer}</p>
                  {latestModuleAiOutput.takeaways.length > 0 && (
                    <div>
                      <strong>{moduleAiText.takeaways}</strong>
                      <ul>
                        {latestModuleAiOutput.takeaways.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {latestModuleAiOutput.suggestedActions.length > 0 && (
                    <div>
                      <strong>{moduleAiText.suggestedActions}</strong>
                      <ul>
                        {latestModuleAiOutput.suggestedActions.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {latestModuleAiOutput.caveats.length > 0 && (
                    <div>
                      <strong>{moduleAiText.caveats}</strong>
                      <ul>
                        {latestModuleAiOutput.caveats.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState label={moduleAiText.empty} />
              )}
              {moduleAiRuns && moduleAiRuns.length > 0 && (
                <div className="module-ai-history">
                  <strong>{moduleAiText.history}</strong>
                  {moduleAiRuns.slice(0, 5).map((run) => (
                    <article className="module-ai-history-row" key={run.id}>
                      <div>
                        <span>{run.createdAt}</span>
                        <small>
                          {run.model}
                          {run.totalTokens ? ` · ${run.totalTokens} ${moduleAiText.tokens}` : ""}
                        </small>
                      </div>
                      <StatusPill status={run.status} />
                    </article>
                  ))}
                </div>
              )}
              </>
            ) : null}
          </ModuleAiFloatingShell>
        )}

        {activeView === "dashboard" && (
          <Dashboard
            collection={collection}
            production={production}
            todayVisits={todayVisits}
            utilization={utilization}
            visibleClinics={visibleClinics}
            visibleAppointments={patientScopedAppointments}
            taskInboxWorkspace={taskInboxWorkspace}
            dashboardWorkspace={dashboardWorkspace}
          />
        )}
        {activeView === "schedule" && (
          <ScheduleBoard
            scheduleWorkspace={scheduleWorkspace}
            visibleAppointments={scheduleScopedAppointments}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "patients" && (
          <PatientsPanel
            patientWorkspace={patientWorkspace}
            role={session.role}
            text={workspaceText[language].patients}
            visibleClinics={visibleClinics}
            visiblePatients={visiblePatients}
          />
        )}
        {(activeView === "journey" ||
          activeView === "clinical" ||
          activeView === "treatment") && (
          <PatientJourneyPanel
            actorName={session.fullName}
            billingWorkspace={billingWorkspace}
            clinicalWorkspace={clinicalWorkspace}
            crmWorkspace={crmWorkspace}
            formsWorkspace={formsWorkspace}
            journeyRecordsWorkspace={journeyRecordsWorkspace}
            patientFilesWorkspace={patientFilesWorkspace}
            patientWorkspace={patientWorkspace}
            pharmacyWorkspace={pharmacyWorkspace}
            scheduleWorkspace={scheduleWorkspace}
            servicesWorkspace={servicesWorkspace}
            settingsWorkspace={settingsWorkspace}
            session={session}
            treatmentWorkspace={treatmentWorkspace}
            chartSearch={journeyChartSearch}
            journeyReceipts={journeyReceipts}
            onUpdateJourneyInvoiceAmount={updateJourneyInvoiceAmount}
            onVoidJourneyInvoiceIfUnpaid={voidJourneyInvoiceIfUnpaid}
            selectedPatientId={journeySelectedPatient?.id ?? ""}
            visibleAppointments={visibleAppointments}
            visibleClinics={visibleClinics}
            visibleInvoices={visibleInvoices}
            visiblePatients={visiblePatients}
            visiblePlans={visiblePlans}
          />
        )}
        {activeView === "billing" && (
          <BillingPanel
            actorName={session.fullName}
            billingSearch={billingSearch}
            billingWorkspace={billingWorkspace}
            journeyInvoiceIds={journeyInvoiceIds}
            journeyReceipts={journeyReceipts}
            onCreateJourneyReceipt={createJourneyReceipt}
            onIssueJourneyInvoiceForService={issueJourneyInvoiceForService}
            onRecordJourneyInvoicePayment={recordJourneyInvoicePayment}
            onVoidJourneyInvoice={voidJourneyInvoice}
            visibleClinicIds={visibleClinicIds}
            visibleAppointments={visibleAppointments}
            visibleClinics={visibleClinics}
            visibleInvoices={patientScopedInvoices}
            visiblePatients={patientScopedPatients}
          />
        )}
        {activeView === "accounting" && (
          <AccountingPanel
            accountingWorkspace={accountingWorkspace}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "crm" && (
          <CrmPanel
            crmWorkspace={crmWorkspace}
            patientWorkspace={patientWorkspace}
            visibleClinicIds={visibleClinicIds}
          />
        )}
        {activeView === "reports" && (
          <ReportsPanel
            reportsWorkspace={reportsWorkspace}
            visibleClinicIds={visibleClinicIds}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "community" && (
          <CommunityPanel
            communityWorkspace={communityWorkspace}
            visibleClinicIds={visibleClinicIds}
          />
        )}
        {activeView === "patient-app" && (
          <PatientAppPanel patientPortalWorkspace={patientPortalWorkspace} />
        )}
        {activeView === "employee-app" && (
          <EmployeeAppPanel
            session={session}
            staffPayrollWorkspace={staffPayrollWorkspace}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "services" && (
          <ServicesPanel servicesWorkspace={servicesWorkspace} />
        )}
        {activeView === "pharmacy" && (
          <PharmacyPanel
            patientWorkspace={patientWorkspace}
            pharmacyWorkspace={pharmacyWorkspace}
            visibleClinicIds={visibleClinicIds}
          />
        )}
        {activeView === "forms" && (
          <FormsPanel
            formsWorkspace={formsWorkspace}
            patientWorkspace={patientWorkspace}
            visibleClinicIds={visibleClinicIds}
          />
        )}
        {activeView === "inventory" && (
          <InventoryPanel
            inventoryWorkspace={inventoryWorkspace}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "learning" && (
          <LearningPanel
            learningWorkspace={learningWorkspace}
            session={session}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "staff" && (
          <StaffPayrollPanel
            settingsWorkspace={settingsWorkspace}
            staffPayrollWorkspace={staffPayrollWorkspace}
            visibleClinics={visibleClinics}
          />
        )}
        {activeView === "settings" && (
          <SettingsPanel
            settingsWorkspace={settingsWorkspace}
            clinicCount={visibleClinics.length}
            role={t.roles[session.role]}
          />
        )}
      </main>
      </div>
    </LanguageContext.Provider>
  );
}

function titleFor(view: ViewKey, language: Language) {
  return uiText[language].titles[view];
}

function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

function stableNumberFromText(value: string, max: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % max;
  }

  return hash + 1;
}

function patientCodeFor(patient: Pick<Patient, "id" | "patientCode"> | null | undefined) {
  if (!patient) {
    return "PT000000";
  }

  if (patient.patientCode) {
    return patient.patientCode;
  }

  const numericId = patient.id.match(/\d+/g)?.join("");
  const sequence = numericId
    ? Number(numericId.slice(-6))
    : stableNumberFromText(patient.id, 999999);

  return `PT${padCodeNumber(sequence || 0, 6)}`;
}

function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`;
}

function patientClassCodeFor(patient: Pick<Patient, "age" | "flags">) {
  const flags = patient.flags.map((flag) => flag.toLowerCase());

  if (patient.age > 0 && patient.age < 16) {
    return "PE";
  }

  if (flags.some((flag) => flag.includes("pediatric") || flag.includes("guardian"))) {
    return "PE";
  }

  return "AD";
}

function patientGenderLabel(gender: string | null | undefined, language: Language) {
  const normalizedGender = String(gender ?? "UNKNOWN").toUpperCase();

  if (normalizedGender === "FEMALE") {
    return language === "vi" ? "Nữ" : "Female";
  }

  if (normalizedGender === "MALE") {
    return language === "vi" ? "Nam" : "Male";
  }

  if (normalizedGender === "OTHER") {
    return language === "vi" ? "Khác" : "Other";
  }

  return language === "vi" ? "Chưa rõ" : "Unknown";
}

type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<
    Pick<
      Patient,
      | "address"
      | "age"
      | "city"
      | "clinicId"
      | "consent"
      | "email"
      | "flags"
      | "gender"
      | "guardianName"
      | "lastVisit"
      | "leadSource"
      | "nationalId"
      | "patientCode"
      | "treatmentProgress"
      | "visitReason"
    >
  >;

function patientLeadSourceOptions(language: Language) {
  return [
    { value: "WALK_IN", label: language === "vi" ? "Vãng lai" : "Walk-in" },
    { value: "FACEBOOK_ADS", label: "Facebook Ads" },
    { value: "GOOGLE_ADS", label: "Google Ads" },
    { value: "TIKTOK", label: "TikTok" },
    { value: "SOCIAL", label: language === "vi" ? "Social / cộng đồng" : "Social / community" },
    { value: "TELESALE", label: "Telesale" },
    { value: "WEBSITE", label: "Website" },
    { value: "ZALO", label: "Zalo" },
    {
      value: "PATIENT_REFERRAL",
      label: language === "vi" ? "Bệnh nhân giới thiệu" : "Patient referral",
    },
    {
      value: "STAFF_REFERRAL",
      label: language === "vi" ? "Nhân sự giới thiệu" : "Staff referral",
    },
    { value: "PARTNER", label: language === "vi" ? "Đối tác" : "Partner" },
    { value: "OTHER", label: language === "vi" ? "Khác" : "Other" },
  ];
}

function patientLeadSourceLabel(source: string | null | undefined, language: Language) {
  const normalizedSource = String(source ?? "WALK_IN").toUpperCase();

  return (
    patientLeadSourceOptions(language).find((option) => option.value === normalizedSource)
      ?.label ?? normalizedSource
  );
}

function PatientSearchCombobox({
  disabled = false,
  hideIcon = false,
  query,
  onQueryChange,
  matches,
  selectedPatient,
  showSelectedPatientLabel = true,
  placeholder,
  selectLabel,
  noResultsLabel,
  onSelect,
}: {
  disabled?: boolean;
  hideIcon?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  matches: PatientSearchRecord[];
  selectedPatient?: PatientSearchRecord | null;
  showSelectedPatientLabel?: boolean;
  placeholder: string;
  selectLabel: string;
  noResultsLabel: string;
  onSelect: (patient: PatientSearchRecord) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeSearchText(query.trim());
  const selectedPatientLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
  const inputValue = query || (showSelectedPatientLabel ? selectedPatientLabel : "");
  const visibleMatches = normalizedQuery
    ? matches.filter((patient) => patient.id !== selectedPatient?.id).slice(0, 8)
    : [];
  const shouldShowResults = isOpen && normalizedQuery.length > 0;

  return (
    <div className="patient-search-combobox">
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true" />}
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-label={selectLabel}
          disabled={disabled}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);

            if (!query && selectedPatientLabel) {
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          placeholder={placeholder}
          value={inputValue}
        />
      </label>
      {shouldShowResults ? (
        <div className="patient-search-results" role="listbox" aria-label={selectLabel}>
          {visibleMatches.length > 0 ? (
            visibleMatches.map((patient) => (
              <button
                className="patient-search-option"
                key={patient.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(patient);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{patient.name}</strong>
                <span>
                  {patientCodeFor(patient)} - {patient.phone}
                  {patient.email ? ` - ${patient.email}` : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="patient-search-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function JourneyPatientMenu({
  appointments,
  billingWorkspace,
  clinics,
  language,
  onClose,
  onOpenBilling,
  onOpenProfile,
  onSelect,
  open,
  patients,
  selectedPatientId,
}: {
  appointments: Appointment[];
  billingWorkspace?: BillingWorkspace | null;
  clinics: Array<{ id: string; name: string }>;
  language: Language;
  onClose: () => void;
  onOpenBilling: (patientId: string) => void;
  onOpenProfile: (patientId: string) => void;
  onSelect: (patient: PatientSearchRecord) => void;
  open: boolean;
  patients: PatientSearchRecord[];
  selectedPatientId: string;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearchText(query.trim());
  const matchedPatients = normalizedQuery
    ? patientSearchMatches(patients, normalizedQuery)
    : patients;
  const matchedIds = new Set(matchedPatients.map((patient) => patient.id));
  const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic.name]));
  const todayAppointmentPatientIds = new Set(
    appointments
      .filter((appointment) => isJourneyTodayAppointment(appointment))
      .filter((appointment) => appointment.status !== "Cancelled" && appointment.status !== "No-show")
      .map((appointment) => appointment.patientId),
  );
  const treatmentPatientIds = new Set(
    billingWorkspace?.treatmentServices
      .filter(
        (service) =>
          service.status !== "COMPLETED" &&
          service.status !== "CANCELLED" &&
          service.currentProgressPercent > 0,
      )
      .map((service) => service.patientId) ?? [],
  );
  const collectionPatientIds = new Set(
    billingWorkspace?.treatmentServices
      .filter((service) => {
        const applied = Math.min(
          service.finalPrice,
          service.collectedAmount + service.creditAllocatedAmount,
        );

        return service.currentProgressPercent > 0 && service.finalPrice - applied > 0;
      })
      .map((service) => service.patientId) ?? [],
  );
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const recentPatients = [...patients]
    .sort((left, right) => patientVisitSortValue(right) - patientVisitSortValue(left))
    .slice(0, 12);
  const groups = [
    {
      key: "today",
      icon: <CalendarCheck size={15} aria-hidden="true" />,
      title: language === "vi" ? "Lịch hôm nay" : "Today",
      patients: patients.filter((patient) => todayAppointmentPatientIds.has(patient.id)),
    },
    {
      key: "treatment",
      icon: <Stethoscope size={15} aria-hidden="true" />,
      title: language === "vi" ? "Đang điều trị" : "In treatment",
      patients: patients.filter(
        (patient) =>
          treatmentPatientIds.has(patient.id) ||
          ((patient.treatmentProgress ?? 0) > 0 && (patient.treatmentProgress ?? 0) < 100),
      ),
    },
    {
      key: "collection",
      icon: <Wallet size={15} aria-hidden="true" />,
      title: language === "vi" ? "Còn phải thu" : "Collection due",
      patients: patients.filter((patient) => collectionPatientIds.has(patient.id)),
    },
    {
      key: "recent",
      icon: <UsersRound size={15} aria-hidden="true" />,
      title: language === "vi" ? "Gần đây" : "Recent",
      patients: recentPatients,
    },
  ];

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="journey-patient-menu-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        aria-label={language === "vi" ? "Menu bệnh nhân" : "Patient menu"}
        aria-modal="true"
        className="journey-patient-menu"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="journey-patient-menu-header">
          <div>
            <span>{language === "vi" ? "Hành trình điều trị" : "Treatment journey"}</span>
            <h3>{language === "vi" ? "Menu bệnh nhân" : "Patient menu"}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={language === "vi" ? "Đóng" : "Close"}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <label className="search-field journey-patient-menu-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder={language === "vi" ? "Tìm tên, mã, số điện thoại" : "Search name, code, phone"}
            value={query}
          />
        </label>

        {selectedPatient ? (
          <div className="journey-patient-current">
            <span>{language === "vi" ? "Đang mở" : "Current chart"}</span>
            <strong>{selectedPatient.name}</strong>
            <small>{patientSearchDisplayLabel(selectedPatient)}</small>
            <div>
              <button type="button" className="secondary-button" onClick={() => onOpenProfile(selectedPatient.id)}>
                {language === "vi" ? "Hồ sơ" : "Profile"}
              </button>
              <button type="button" className="secondary-button" onClick={() => onOpenBilling(selectedPatient.id)}>
                {language === "vi" ? "Thu tiền" : "Billing"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="journey-patient-menu-list">
          {groups.map((group) => {
            const groupPatients = group.patients
              .filter((patient) => matchedIds.has(patient.id))
              .slice(0, 8);

            if (groupPatients.length === 0) {
              return null;
            }

            return (
              <section className="journey-patient-menu-group" key={group.key}>
                <h4>
                  {group.icon}
                  {group.title}
                </h4>
                {groupPatients.map((patient) => (
                  <button
                    className={
                      patient.id === selectedPatientId
                        ? "journey-patient-menu-card active"
                        : "journey-patient-menu-card"
                    }
                    key={`${group.key}-${patient.id}`}
                    onClick={() => onSelect(patient)}
                    type="button"
                  >
                    <strong>{patient.name}</strong>
                    <span>
                      {patientCodeFor(patient)} · {patient.phone}
                    </span>
                    <small>
                      {clinicById.get(patient.clinicId ?? "") ?? patient.city ?? ""}
                      {patient.visitReason ? ` · ${patient.visitReason}` : ""}
                    </small>
                  </button>
                ))}
              </section>
            );
          })}

          {matchedPatients.length === 0 ? (
            <div className="journey-patient-menu-empty">
              {language === "vi" ? "Không tìm thấy bệnh nhân phù hợp." : "No matching patients."}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function isJourneyTodayAppointment(appointment: Appointment) {
  if (!appointment.startsAt) {
    return true;
  }

  const startsAt = new Date(appointment.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    return false;
  }

  const today = new Date();

  return (
    startsAt.getFullYear() === today.getFullYear() &&
    startsAt.getMonth() === today.getMonth() &&
    startsAt.getDate() === today.getDate()
  );
}

function patientVisitSortValue(patient: PatientSearchRecord) {
  const dateValue = Date.parse(String(patient.lastVisit ?? ""));

  if (!Number.isNaN(dateValue)) {
    return dateValue;
  }

  return stableNumberFromText(patient.id, 100000);
}

function patientMatchesExactSelectorSearch(patient: PatientSearchRecord, query: string) {
  return matchesChartSearch(query, [
    patient.name,
    patient.phone,
    patientCodeFor(patient),
    typeof patient.age === "number" && patient.flags ? patientClassCodeFor(patient as Patient) : null,
    patient.email,
    patientGenderLabel(patient.gender, "vi"),
    patientGenderLabel(patient.gender, "en"),
    patientLeadSourceLabel(patient.leadSource, "vi"),
    patientLeadSourceLabel(patient.leadSource, "en"),
    patient.visitReason,
    patient.nationalId,
    patient.address,
    patient.city,
    patient.guardianName,
    patient.consent,
    ...(patient.flags ?? []),
  ]);
}

function patientSearchMatches(patients: PatientSearchRecord[], query: string) {
  if (!query) {
    return patients;
  }

  return patients
    .map((patient, index) => ({
      patient,
      index,
      rank: patientSearchRank(patient, query),
    }))
    .filter((item) => item.rank < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.patient);
}

function patientSearchRank(patient: PatientSearchRecord, query: string) {
  const name = normalizeSearchText(patient.name);
  const phone = normalizeSearchText(patient.phone);
  const code = normalizeSearchText(patientCodeFor(patient));
  const nameTokens = name.split(/\s+/).filter(Boolean);

  if (code.startsWith(query) || phone.startsWith(query)) {
    return 0;
  }

  if (nameTokens.some((token) => token.startsWith(query))) {
    return 1;
  }

  if (name.includes(query)) {
    return 2;
  }

  if (code.includes(query) || phone.includes(query)) {
    return 3;
  }

  return patientMatchesExactSelectorSearch(patient, query)
    ? 4
    : Number.POSITIVE_INFINITY;
}

const journeyTopbarText = {
  vi: {
    clearSearch: "Xóa tìm kiếm",
    patientMenu: "Bệnh nhân",
    searchPlaceholder: "Tìm bệnh nhân, điện thoại, lý do khám, kế hoạch, dịch vụ, timeline",
    selectPatient: "Chọn bệnh nhân",
  },
  en: {
    clearSearch: "Clear search",
    patientMenu: "Patients",
    searchPlaceholder: "Search patient, phone, visit reason, plan, service, timeline",
    selectPatient: "Select patient",
  },
} as const;

const billingTopbarText = {
  vi: {
    clearSearch: "Xóa tìm kiếm",
    searchPlaceholder: "Tìm bệnh nhân, dịch vụ, răng, hóa đơn",
  },
  en: {
    clearSearch: "Clear search",
    searchPlaceholder: "Search patient, service, tooth, invoice",
  },
} as const;

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function matchesChartSearch(
  query: string,
  values: Array<string | number | null | undefined>,
) {
  if (!query) {
    return true;
  }

  return values.some((value) => normalizeSearchText(value).includes(query));
}

type AccountingChatOutput = {
  answer: string;
  takeaways: string[];
  suggestedActions: string[];
  caveats: string[];
};

function accountingChatOutput(value: unknown): AccountingChatOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const answer = stringValue(record.answer);

  if (!answer) {
    return null;
  }

  return {
    answer,
    takeaways: normalizeAiStringArray(record.takeaways),
    suggestedActions: normalizeAiStringArray(record.suggestedActions),
    caveats: normalizeAiStringArray(record.caveats),
  };
}

function moduleAiOutput(value: unknown): AccountingChatOutput | null {
  return accountingChatOutput(value);
}

type ModuleAiContextInput = {
  activeView: ViewKey;
  accountingWorkspace?: AccountingWorkspace | null;
  billingWorkspace?: BillingWorkspace | null;
  clinicalWorkspace?: ClinicalWorkspaceData | null;
  communityWorkspace?: CommunityWorkspaceData | null;
  crmWorkspace?: CrmWorkspace | null;
  dashboardWorkspace?: DashboardWorkspace | null;
  formsWorkspace?: FormsWorkspace | null;
  inventoryWorkspace?: InventoryWorkspace | null;
  journeySelectedPatient?: Patient | null;
  journeyRecordsWorkspace?: JourneyRecordsWorkspace | null;
  learningWorkspace?: LearningWorkspace | null;
  patientFilesWorkspace?: PatientFilesWorkspace | null;
  patientPortalWorkspace?: PatientPortalWorkspace | null;
  patientWorkspace?: PatientWorkspace | null;
  pharmacyWorkspace?: PharmacyWorkspace | null;
  reportsWorkspace?: ReportsWorkspace | null;
  scheduleWorkspace?: ScheduleWorkspace | null;
  servicesWorkspace?: ServicesWorkspace | null;
  settingsWorkspace?: SettingsWorkspace | null;
  staffPayrollWorkspace?: StaffPayrollWorkspace | null;
  taskInboxWorkspace?: TaskInboxWorkspace | null;
  treatmentWorkspace?: TreatmentWorkspace | null;
};

function buildModuleAiContext(input: ModuleAiContextInput) {
  const workspace = (() => {
    switch (input.activeView) {
      case "dashboard":
        return {
          dashboardWorkspace: input.dashboardWorkspace,
          taskInboxWorkspace: input.taskInboxWorkspace,
        };
      case "accounting":
        return { accountingWorkspace: input.accountingWorkspace };
      case "schedule":
        return { scheduleWorkspace: input.scheduleWorkspace };
      case "patients":
        return { patientWorkspace: input.patientWorkspace };
      case "journey":
      case "clinical":
      case "treatment":
        const scopedPatientId = input.journeySelectedPatient?.id ?? "";
        const scopedPatientName = input.journeySelectedPatient?.name;

        return {
          selectedPatient: input.journeySelectedPatient ?? null,
          selectedPatientId: scopedPatientId || null,
          patientWorkspace: scopeAiWorkspaceToPatient(
            input.patientWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          clinicalWorkspace: scopeAiWorkspaceToPatient(
            input.clinicalWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          treatmentWorkspace: scopeAiWorkspaceToPatient(
            input.treatmentWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          billingWorkspace: scopeAiWorkspaceToPatient(
            input.billingWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          journeyRecordsWorkspace: scopeAiWorkspaceToPatient(
            input.journeyRecordsWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          patientFilesWorkspace: scopeAiWorkspaceToPatient(
            input.patientFilesWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          pharmacyWorkspace: scopeAiWorkspaceToPatient(
            input.pharmacyWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          formsWorkspace: scopeAiWorkspaceToPatient(
            input.formsWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
          crmWorkspace: scopeAiWorkspaceToPatient(
            input.crmWorkspace,
            scopedPatientId,
            scopedPatientName,
          ),
        };
      case "billing":
        return {
          billingWorkspace: input.billingWorkspace,
          patientWorkspace: input.patientWorkspace,
        };
      case "services":
        return { servicesWorkspace: input.servicesWorkspace };
      case "staff":
      case "employee-app":
        return {
          staffPayrollWorkspace: input.staffPayrollWorkspace,
          settingsWorkspace: settingsAiContext(input.settingsWorkspace),
          servicesWorkspace: input.servicesWorkspace,
        };
      case "crm":
        return {
          crmWorkspace: input.crmWorkspace,
          patientWorkspace: input.patientWorkspace,
        };
      case "inventory":
        return { inventoryWorkspace: input.inventoryWorkspace };
      case "pharmacy":
        return {
          pharmacyWorkspace: input.pharmacyWorkspace,
          patientWorkspace: input.patientWorkspace,
        };
      case "forms":
        return {
          formsWorkspace: input.formsWorkspace,
          patientWorkspace: input.patientWorkspace,
        };
      case "learning":
        return { learningWorkspace: input.learningWorkspace };
      case "reports":
        return { reportsWorkspace: input.reportsWorkspace };
      case "community":
        return { communityWorkspace: input.communityWorkspace };
      case "patient-app":
        return { patientPortalWorkspace: input.patientPortalWorkspace };
      case "settings":
        return { settingsWorkspace: settingsAiContext(input.settingsWorkspace) };
      default:
        return {};
    }
  })();

  return compactAiValue({
    activeView: input.activeView,
    generatedAt: new Date().toISOString(),
    workspace,
  });
}

function settingsAiContext(workspace?: SettingsWorkspace | null) {
  if (!workspace) {
    return workspace;
  }

  const staffByRole = workspace.staff.reduce<Record<string, number>>((totals, member) => {
    const key = member.role;
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});
  const activeStaff = workspace.staff.filter((member) => member.active);
  const inactiveStaff = workspace.staff.filter((member) => !member.active);

  return {
    source: workspace.source,
    canMutate: workspace.canMutate,
    message: workspace.message,
    chains: workspace.chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      ownerName: chain.ownerName,
      ownerEmail: chain.ownerEmail,
      specialty: chain.specialty,
      active: chain.active,
      clinicCount: chain.clinicCount,
    })),
    clinics: workspace.clinics.map((clinic) => ({
      id: clinic.id,
      name: clinic.name,
      city: clinic.city,
      chainName: clinic.chainName,
      active: clinic.active,
    })),
    archivedClinics: workspace.archivedClinics.map((clinic) => ({
      clinicId: clinic.clinicId,
      name: clinic.name,
      city: clinic.city,
      patientCount: clinic.patientCount,
      appointmentCount: clinic.appointmentCount,
      invoiceCount: clinic.invoiceCount,
      staffCount: clinic.staffCount,
    })),
    staffSummary: {
      total: workspace.staff.length,
      active: activeStaff.length,
      inactive: inactiveStaff.length,
      mustChangePassword: workspace.staff.filter((member) => member.mustChangePassword).length,
      pendingPasswordSetup: workspace.staff.filter((member) => member.hasPendingPasswordSetup).length,
      byRole: staffByRole,
    },
    activeStaffSample: activeStaff.slice(0, 12).map((member) => ({
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      title: member.title,
      employeeCode: member.employeeCode,
      primaryClinicId: member.primaryClinicId,
      clinicCount: member.clinics.length,
      lastLoginAt: member.lastLoginAt,
    })),
    inactiveStaffSample: inactiveStaff.slice(0, 8).map((member) => ({
      id: member.id,
      fullName: member.fullName,
      email: member.email,
      role: member.role,
      employeeCode: member.employeeCode,
    })),
    notificationSettings: workspace.notificationSettings,
    aiSettings: workspace.aiSettings,
    sourceCommissionSummary: {
      policies: workspace.sourceCommission.policies.length,
      accruals: workspace.sourceCommission.accruals.length,
      openAccruals: workspace.sourceCommission.accruals.filter((accrual) => accrual.status !== "PAID" && accrual.status !== "VOID").length,
    },
    recentAuditActions: workspace.auditLogs.slice(0, 8).map((log) => ({
      action: log.action,
      actor: log.actor,
      entityType: log.entityType,
      createdAt: log.createdAt,
    })),
    recentAiRuns: workspace.aiRuns.slice(0, 5).map((run) => ({
      module: run.module,
      status: run.status,
      model: run.model,
      error: run.error ? run.error.slice(0, 160) : null,
      createdAt: run.createdAt,
    })),
  };
}

function scopeAiWorkspaceToPatient<T>(
  workspace: T,
  patientId: string,
  patientName?: string,
): T {
  if (!workspace || !patientId || typeof workspace !== "object") {
    return workspace;
  }

  const scoped = { ...(workspace as Record<string, unknown>) };

  for (const [key, value] of Object.entries(scoped)) {
    if (!Array.isArray(value)) {
      continue;
    }

    if (key === "patients") {
      scoped[key] = value.filter((item) => {
        const record = item as Record<string, unknown>;
        return record.id === patientId;
      });
      continue;
    }

    const containsPatientScopedRows = value.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }

      const record = item as Record<string, unknown>;
      return "patientId" in record || "patientName" in record || "patient" in record;
    });

    if (!containsPatientScopedRows) {
      continue;
    }

    scoped[key] = value.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }

      const record = item as Record<string, unknown>;
      return (
        record.patientId === patientId ||
        (patientName && (record.patientName === patientName || record.patient === patientName))
      );
    });
  }

  return scoped as T;
}

function compactAiValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 700 ? `${value.slice(0, 700)}...` : value;
  }

  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, depth > 1 ? 8 : 16).map((item) => compactAiValue(item, depth + 1)),
    };
  }

  if (typeof value === "object") {
    if (depth > 4) {
      return "[truncated]";
    }

    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/password|token|hash|secret|storageKey|rawOutput/i.test(key))
      .slice(0, 60);

    for (const [key, child] of entries) {
      output[key] = compactAiValue(child, depth + 1);
    }

    return output;
  }

  return String(value);
}

function stringifyAiContext(context: unknown) {
  const serialized = JSON.stringify(context);

  if (serialized.length <= 110000) {
    return serialized;
  }

  return JSON.stringify({
    note: "Module context was truncated on the client because it exceeded the AI payload budget.",
    truncatedContextPreview: serialized.slice(0, 100000),
  });
}

function normalizeAiStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return (
    <BaseStatusPill label={displayStatus(status, language)} status={status} />
  );
}

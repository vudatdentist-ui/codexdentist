import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { Language } from "@/components/AppLanguage";
import type { ViewKey } from "@/lib/permissions";

export type AppShellNavItem = {
  key: ViewKey;
  icon: LucideIcon;
  label: Record<Language, string>;
};

export type AppShellNavGroup = {
  label: Record<Language, string>;
  items: AppShellNavItem[];
};

// Migration-only compatibility IA. This intentionally mirrors the legacy
// module navigation while routes move out of DentalSuite. It is not the final
// workflow-first product navigation described in the architecture direction.
export const migrationCompatibilityNavigation: AppShellNavGroup[] = [
  {
    label: { vi: "Tổng quan", en: "Overview" },
    items: [
      { key: "dashboard", icon: LayoutDashboard, label: { vi: "Tổng quan", en: "Dashboard" } },
      { key: "reports", icon: BarChart3, label: { vi: "Báo cáo", en: "Reports" } },
      { key: "accounting", icon: WalletCards, label: { vi: "Kế toán", en: "Accounting" } },
    ],
  },
  {
    label: { vi: "Bệnh nhân", en: "Patients" },
    items: [
      { key: "schedule", icon: CalendarDays, label: { vi: "Lịch hẹn", en: "Schedule" } },
      { key: "patients", icon: UsersRound, label: { vi: "Bệnh nhân", en: "Patients" } },
      { key: "journey", icon: Stethoscope, label: { vi: "Hành trình điều trị", en: "Patient journey" } },
      { key: "billing", icon: CreditCard, label: { vi: "Thanh toán", en: "Billing" } },
      { key: "crm", icon: Inbox, label: { vi: "CSKH", en: "CRM" } },
      { key: "patient-app", icon: Smartphone, label: { vi: "Ứng dụng bệnh nhân", en: "Patient app" } },
    ],
  },
  {
    label: { vi: "Lâm sàng", en: "Clinical" },
    items: [
      { key: "services", icon: ClipboardList, label: { vi: "Dịch vụ", en: "Services" } },
      { key: "pharmacy", icon: FileText, label: { vi: "Đơn thuốc", en: "Pharmacy" } },
      { key: "forms", icon: ShieldCheck, label: { vi: "Biểu mẫu", en: "Forms" } },
    ],
  },
  {
    label: { vi: "Nội bộ", en: "Internal" },
    items: [
      { key: "staff", icon: Building2, label: { vi: "Nhân sự", en: "Staff" } },
      { key: "employee-app", icon: Smartphone, label: { vi: "Ứng dụng nhân viên", en: "Staff app" } },
      { key: "learning", icon: FileText, label: { vi: "Đào tạo", en: "Learning" } },
      { key: "community", icon: MessageSquareText, label: { vi: "Cộng đồng", en: "Community" } },
      { key: "inventory", icon: ClipboardList, label: { vi: "Kho vật tư", en: "Inventory" } },
    ],
  },
  {
    label: { vi: "Hệ thống", en: "System" },
    items: [
      { key: "settings", icon: Settings, label: { vi: "Cài đặt", en: "Settings" } },
    ],
  },
];

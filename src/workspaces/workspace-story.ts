import type { ViewKey } from "@/lib/permissions";

export type StoryLanguage = "vi" | "en";
export type WorkspaceChapter = "day" | "care" | "practice" | "team";
type Copy = Record<StoryLanguage, string>;
type Story = { chapter: WorkspaceChapter; label: Copy; title: Copy };
const c = (vi: string, en: string): Copy => ({ vi, en });
const s = (chapter: WorkspaceChapter, label: Copy): Story => ({ chapter, label, title: label });

// Chapter numbers orient the workspace; they do not describe clinical progress.
export const workspaceChapters = {
  day: { number: "01", title: c("Ngày làm việc", "The working day") },
  care: { number: "02", title: c("Hành trình chăm sóc", "Continuity of care") },
  practice: { number: "03", title: c("Vận hành phòng khám", "The practice") },
  team: { number: "04", title: c("Cùng đội ngũ", "The team") },
};

export const workspaceStories: Record<ViewKey, Story> = {
  dashboard: s("day", c("Hôm nay", "Today")),
  schedule: s("day", c("Lịch hẹn", "Appointments")),
  patients: s("care", c("Hồ sơ bệnh nhân", "Patient records")),
  journey: s("care", c("Hành trình điều trị", "Care journey")),
  clinical: s("care", c("Khám tại ghế", "Chairside care")),
  treatment: s("care", c("Kế hoạch điều trị", "Treatment plans")),
  billing: s("care", c("Thanh toán", "Payments")),
  crm: s("care", c("Chăm sóc sau hẹn", "Follow-up care")),
  "patient-app": s("care", c("Cổng bệnh nhân", "Patient portal")),
  accounting: s("practice", c("Sổ thu chi", "Practice accounts")),
  reports: s("practice", c("Báo cáo", "Reports")),
  services: s("practice", c("Danh mục dịch vụ", "Service catalogue")),
  inventory: s("practice", c("Vật tư & thiết bị", "Supplies & equipment")),
  pharmacy: s("care", c("Đơn thuốc", "Prescriptions")),
  forms: s("care", c("Biểu mẫu & đồng thuận", "Forms & consent")),
  staff: s("team", c("Nhân sự & tiền lương", "People & payroll")),
  "employee-app": s("day", c("Ca làm của tôi", "My shift")),
  learning: s("team", c("Học tập", "Learning")),
  community: s("team", c("Trao đổi nội bộ", "Team conversations")),
  settings: s("practice", c("Thiết lập", "Settings")),
};
export const workspaceNavigation: ReadonlyArray<{ chapter: WorkspaceChapter; views: readonly ViewKey[] }> = [
  { chapter: "day", views: ["dashboard", "schedule", "employee-app"] },
  { chapter: "care", views: ["patients", "journey", "billing", "crm", "pharmacy", "forms", "patient-app"] },
  { chapter: "practice", views: ["services", "inventory", "accounting", "reports", "settings"] },
  { chapter: "team", views: ["staff", "learning", "community"] },
];
export function viewFromPath(path: string): ViewKey | undefined {
  const segment = path.split(/[?#]/, 1)[0].split("/").filter(Boolean)[0];
  return segment && Object.hasOwn(workspaceStories, segment) ? segment as ViewKey : undefined;
}
export function normalizeWorkspaceSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
}
export function visibleWorkspaceNavigation(permitted: ReadonlySet<ViewKey>, language: StoryLanguage, query = "") {
  const search = normalizeWorkspaceSearch(query);
  return workspaceNavigation.map(group => ({ ...group,
    views: group.views.filter(view => permitted.has(view) && normalizeWorkspaceSearch(workspaceStories[view].label[language]).includes(search)),
  })).filter(group => group.views.length > 0);
}

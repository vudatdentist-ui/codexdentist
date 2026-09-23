import type { ViewKey } from "@/lib/permissions";

export type StoryLanguage = "vi" | "en";
export type WorkspaceChapter = "day" | "care" | "practice" | "team";
type Copy = Record<StoryLanguage, string>;
type Story = { chapter: WorkspaceChapter; label: Copy; title: Copy; purpose: Copy };
const c = (vi: string, en: string): Copy => ({ vi, en });
const s = (chapter: WorkspaceChapter, label: Copy, title: Copy, purpose: Copy): Story => ({ chapter, label, title, purpose });

// Chapter numbers orient the workspace; they do not describe clinical progress.
export const workspaceChapters = {
  day: { number: "01", title: c("Ngày làm việc", "The working day") },
  care: { number: "02", title: c("Hành trình chăm sóc", "Continuity of care") },
  practice: { number: "03", title: c("Vận hành phòng khám", "The practice") },
  team: { number: "04", title: c("Cùng đội ngũ", "The team") },
};

export const workspaceStories: Record<ViewKey, Story> = {
  dashboard: s("day", c("Hôm nay", "Today"), c("Ngày làm việc", "The working day"), c("Lịch hẹn, việc cần xử lý và tình hình phòng khám.", "Appointments, open work, and the practice at a glance.")),
  schedule: s("day", c("Lịch hẹn", "Appointments"), c("Sẵn sàng cho lượt hẹn tiếp theo", "Ready for the next visit"), c("Sắp lịch, đón bệnh nhân và theo dõi từng lượt khám.", "Plan visits, welcome patients, and follow each appointment.")),
  patients: s("care", c("Hồ sơ bệnh nhân", "Patient records"), c("Bắt đầu từ một người bệnh", "Begin with the person"), c("Tìm hồ sơ, xem lưu ý và tiếp nối lần chăm sóc trước.", "Find a record, review important notes, and continue their care.")),
  journey: s("care", c("Hành trình điều trị", "Care journey"), c("Một hồ sơ, cả hành trình", "One record, the whole journey"), c("Theo dõi bệnh án, kế hoạch và các lần điều trị.", "Follow the clinical record, treatment plan, and each visit.")),
  clinical: s("care", c("Khám tại ghế", "Chairside care"), c("Ghi nhận lần khám này", "Document this visit"), c("Xem bệnh án và ghi nhận lâm sàng theo từng giai đoạn.", "Review the chart and document each clinical stage.")),
  treatment: s("care", c("Kế hoạch điều trị", "Treatment plans"), c("Rõ bước điều trị tiếp theo", "The next step in treatment"), c("Theo dõi kế hoạch và tiến độ dịch vụ đã thống nhất.", "Follow agreed treatment plans and service progress.")),
  billing: s("care", c("Thanh toán", "Payments"), c("Rõ từng khoản thu", "Clarity in every payment"), c("Ghi nhận thu tiền, phân bổ thanh toán và theo dõi công nợ.", "Record receipts, allocate payments, and follow outstanding balances.")),
  crm: s("care", c("Chăm sóc sau hẹn", "Follow-up care"), c("Sau lượt hẹn, vẫn đồng hành", "Care beyond the visit"), c("Theo dõi lịch nhắc, phản hồi và việc cần liên hệ lại.", "Follow reminders, feedback, and patients who need a call back.")),
  "patient-app": s("care", c("Cổng bệnh nhân", "Patient portal"), c("Hành trình chăm sóc của bạn", "Your care journey"), c("Xem lịch hẹn và thông tin chăm sóc được chia sẻ với bạn.", "View your appointments and the care information shared with you.")),
  accounting: s("practice", c("Sổ thu chi", "Practice accounts"), c("Nắm rõ dòng tiền", "Keep the accounts in view"), c("Đối chiếu thu chi và theo dõi các khoản cần quyết toán.", "Reconcile income, expenses, and outstanding settlements.")),
  reports: s("practice", c("Báo cáo", "Reports"), c("Nhìn lại để làm tốt hơn", "Review the work, plan ahead"), c("Đọc số liệu theo kỳ và phòng khám.", "Review results by period and clinic.")),
  services: s("practice", c("Danh mục dịch vụ", "Service catalogue"), c("Thống nhất dịch vụ chăm sóc", "A shared service catalogue"), c("Quản lý dịch vụ, giá và các thiết lập liên quan.", "Manage services, prices, and related settings.")),
  inventory: s("practice", c("Vật tư & thiết bị", "Supplies & equipment"), c("Chuẩn bị đủ cho ngày chăm sóc", "Prepare for the day of care"), c("Theo dõi tồn kho, cấp phát và tình trạng thiết bị.", "Track stock, supply movements, and equipment condition.")),
  pharmacy: s("care", c("Đơn thuốc", "Prescriptions"), c("Dặn dò rõ, chăm sóc tiếp nối", "Clear instructions for continued care"), c("Lập đơn thuốc và tra cứu danh mục thuốc.", "Prepare prescriptions and consult the medicine catalogue.")),
  forms: s("care", c("Biểu mẫu & đồng thuận", "Forms & consent"), c("Cùng hiểu, cùng thống nhất", "A shared understanding of care"), c("Chuẩn bị biểu mẫu và theo dõi phiếu đồng thuận.", "Prepare forms and follow consent records.")),
  staff: s("team", c("Nhân sự & tiền lương", "People & payroll"), c("Phía sau mỗi lần chăm sóc", "The team behind every visit"), c("Quản lý nhân sự, chấm công và tiền lương.", "Manage staff records, attendance, and payroll.")),
  "employee-app": s("day", c("Ca làm của tôi", "My shift"), c("Sẵn sàng cho ca làm", "Ready for your shift"), c("Xem công việc và thông tin cá nhân của bạn.", "Find your work and personal staff information.")),
  learning: s("team", c("Học tập", "Learning"), c("Tích lũy từng ngày", "Keep learning, together"), c("Tìm tài liệu và tiếp tục các khóa học.", "Find learning material and continue your courses.")),
  community: s("team", c("Trao đổi nội bộ", "Team conversations"), c("Để đội ngũ luôn cùng nhịp", "Keep the team connected"), c("Chia sẻ thông tin và trao đổi trong phòng khám.", "Share updates and discuss work within your practice.")),
  settings: s("practice", c("Thiết lập", "Settings"), c("Cách phòng khám của bạn vận hành", "How your practice works"), c("Thiết lập phòng khám, phân quyền và tùy chọn vận hành.", "Configure clinics, access, and practice preferences.")),
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

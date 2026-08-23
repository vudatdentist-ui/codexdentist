import { getUnifiedEarningsWorkspace } from "@/features/earnings/server/get-unified-earnings";
import { requireViewSession } from "@/lib/auth";
import { MyStaffWorkspace } from "@/workspaces/operations/MyStaffWorkspace";

const noticeText: Record<string, string> = {
  "staff-profile-missing": "Không tìm thấy hồ sơ nhân sự trong phạm vi phòng khám này.",
  "staff-attendance-open": "Bạn đang có một ca chưa đóng.",
  "staff-clocked-in": "Đã ghi nhận vào ca.",
  "staff-attendance-missing": "Không tìm thấy ca đang mở.",
  "staff-clocked-out": "Đã ghi nhận ra ca.",
  "staff-leave-missing": "Chọn kỳ nghỉ hợp lệ trước khi gửi.",
  "staff-leave-created": "Đã gửi đơn nghỉ.",
  "staff-database": "Chưa lưu được thay đổi. Vui lòng thử lại.",
};

export default async function EmployeeAppPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const session = await requireViewSession("employee-app");
  const [model, params] = await Promise.all([
    getUnifiedEarningsWorkspace(session, { scope: "self" }),
    searchParams,
  ]);
  const rawNotice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const notice = rawNotice ? noticeText[rawNotice] ?? null : null;

  return <MyStaffWorkspace model={model} notice={notice} session={session} />;
}

import { redirect } from "next/navigation";
import {
  canAccessFinanceOperations,
  getFinanceOperations,
} from "@/features/finance/server/get-finance-operations";
import { requireViewSession } from "@/lib/auth";
import { FinanceWorkspace } from "@/workspaces/operations/FinanceWorkspace";

const noticeText: Record<string, string> = {
  "einvoice-denied": "Bạn không có quyền thao tác hóa đơn điện tử.",
  "einvoice-invoice-unavailable": "Không tìm thấy hóa đơn trong phạm vi hiện tại.",
  "einvoice-request-pending": "HĐĐT đang chờ xử lý. Không gửi yêu cầu phát hành trùng.",
  "einvoice-request-state-invalid": "Trạng thái HĐĐT hiện tại không cho phép gửi yêu cầu phát hành mới. Hãy đồng bộ hoặc đối soát trước.",
  "einvoice-sync-state-invalid": "Chỉ HĐĐT lỗi hoặc đang chờ quá lâu mới được đồng bộ lại.",
  "einvoice-state-conflict": "Trạng thái HĐĐT vừa thay đổi ở phiên khác. Dữ liệu mới nhất đã được giữ nguyên; hãy tải lại trước khi thao tác tiếp.",
  "einvoice-external-duplicate": "Mã HĐĐT ngoài hệ thống này đã được gắn với một hóa đơn khác trong cùng tổ chức.",
  "einvoice-provider-failed": "Nhà cung cấp HĐĐT chưa sẵn sàng hoặc đồng bộ thất bại. Việc này đã được đưa vào Công việc.",
  "einvoice-requested": "Đã gửi yêu cầu HĐĐT.",
  "einvoice-synced": "Đã đồng bộ trạng thái HĐĐT.",
  "einvoice-manual-missing": "Cần mã HĐĐT ngoài hệ thống để đối soát.",
  "einvoice-manual-state-invalid": "Trạng thái hiện tại chưa cho phép xác nhận phát hành thủ công; hãy hoàn tất hoặc đồng bộ thao tác đang chờ trước.",
  "einvoice-manual-issued": "Đã ghi nhận HĐĐT phát hành ngoài hệ thống.",
  "einvoice-issued-cannot-ignore": "Trạng thái HĐĐT hiện tại không thể chuyển thành không yêu cầu.",
  "einvoice-not-required": "Đã ghi nhận hóa đơn này không yêu cầu HĐĐT.",
  "einvoice-cancel-requires-void": "Chỉ xác nhận hủy HĐĐT sau khi hóa đơn nội bộ đã VOID.",
  "einvoice-cancel-state-invalid": "Trạng thái HĐĐT hiện tại không thể ghi nhận hủy.",
  "einvoice-cancelled": "Đã ghi nhận HĐĐT được hủy ngoài hệ thống.",
  "einvoice-replacement-missing": "Cần mã HĐĐT mới và tham chiếu thay thế.",
  "einvoice-replacement-state-invalid": "Chỉ HĐĐT đã phát hành mới có thể ghi nhận thay thế; thao tác trùng cũng bị chặn.",
  "einvoice-replaced": "Đã ghi nhận HĐĐT thay thế.",
};

export default async function FinanceOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const session = await requireViewSession("billing");
  if (!canAccessFinanceOperations(session)) {
    redirect("/unauthorized");
  }

  const [model, params] = await Promise.all([
    getFinanceOperations(session),
    searchParams,
  ]);
  const rawNotice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const notice = rawNotice ? noticeText[rawNotice] ?? null : null;

  return <FinanceWorkspace model={model} notice={notice} session={session} />;
}

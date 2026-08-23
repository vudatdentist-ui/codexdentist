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
  "einvoice-already-issued": "Hóa đơn điện tử này đã được ghi nhận phát hành.",
  "einvoice-provider-failed": "Nhà cung cấp HĐĐT chưa sẵn sàng hoặc đồng bộ thất bại. Việc này đã được đưa vào Công việc.",
  "einvoice-requested": "Đã gửi yêu cầu HĐĐT.",
  "einvoice-synced": "Đã đồng bộ trạng thái HĐĐT.",
  "einvoice-manual-missing": "Cần mã HĐĐT ngoài hệ thống để đối soát.",
  "einvoice-manual-issued": "Đã ghi nhận HĐĐT phát hành ngoài hệ thống.",
  "einvoice-issued-cannot-ignore": "HĐĐT đã phát hành không thể chuyển thành không yêu cầu.",
  "einvoice-not-required": "Đã ghi nhận hóa đơn này không yêu cầu HĐĐT.",
  "einvoice-cancel-requires-void": "Chỉ xác nhận hủy HĐĐT sau khi hóa đơn nội bộ đã VOID.",
  "einvoice-cancel-state-invalid": "Trạng thái HĐĐT hiện tại không thể ghi nhận hủy.",
  "einvoice-cancelled": "Đã ghi nhận HĐĐT được hủy ngoài hệ thống.",
  "einvoice-replacement-missing": "Cần mã HĐĐT mới và tham chiếu thay thế.",
  "einvoice-replacement-state-invalid": "Chỉ HĐĐT đã phát hành mới có thể ghi nhận thay thế.",
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

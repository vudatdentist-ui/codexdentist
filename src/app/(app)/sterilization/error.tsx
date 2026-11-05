"use client";

export default function SterilizationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="workspace-error"><h1>Không thể tải chu kỳ vô trùng</h1><p>Hệ thống chưa đọc được lịch sử vô trùng. Kiểm tra kết nối rồi thử lại; dữ liệu chu kỳ không bị xóa.</p><button className="primary-button" type="button" onClick={reset}>Thử lại</button></main>;
}

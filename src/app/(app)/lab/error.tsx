"use client";

export default function LabError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="workspace-error"><h1>Không thể tải ca labo</h1><p>Hệ thống chưa đọc được danh sách labo. Kiểm tra kết nối rồi thử lại; không có chuyển trạng thái nào được thực hiện.</p><button className="primary-button" type="button" onClick={reset}>Thử lại</button></main>;
}

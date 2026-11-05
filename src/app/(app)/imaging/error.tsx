"use client";

export default function ImagingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="workspace-error"><h1>Không thể tải phim chụp</h1><p>Chưa thể đọc danh sách phim. Kiểm tra kết nối rồi thử lại.</p><button className="primary-button" type="button" onClick={reset}>Thử lại</button></main>;
}

"use client";

export default function ImagingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="workspace-error"><h1>Không thể tải dữ liệu hình ảnh</h1><p>PACS hoặc kết nối imaging đang tạm thời không khả dụng. Dữ liệu tham chiếu không bị thay đổi.</p><button className="primary-button" type="button" onClick={reset}>Thử lại</button></main>;
}

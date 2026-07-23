"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="error-shell">
      <section className="error-panel">
        <div className="error-mark">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">Không tải được màn hình</p>
          <h1>Màn hình này chưa mở được.</h1>
          <p>
            Phiên đăng nhập vẫn còn hiệu lực. Thử tải lại màn hình hoặc quay về trang trước.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={reset}>
          <RefreshCw size={16} />
          Tải lại
        </button>
      </section>
    </main>
  );
}

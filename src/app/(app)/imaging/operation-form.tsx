"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui";
import styles from "./operations.module.css";

export function OperationForm({ endpoint, children, submitLabel, successMessage, arrayFields = [], disabled = false, resetOnSuccess = true }: {
  endpoint: string;
  children: ReactNode;
  submitLabel: string;
  successMessage: string;
  arrayFields?: string[];
  disabled?: boolean;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || refreshing || disabled) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload: Record<string, string | string[]> = {};
    for (const [key, value] of data) payload[key] = String(value);
    for (const key of arrayFields) payload[key] = data.getAll(key).map(String);
    if (arrayFields.some(key => payload[key].length === 0)) {
      setFailed(true);
      setMessage("Chọn ít nhất một dụng cụ cho chu kỳ.");
      return;
    }
    sending.current = true;
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setFailed(true);
        setMessage(response.status === 401 ? "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại."
          : response.status === 403 ? "Bạn chưa có quyền thực hiện thao tác này."
            : response.status === 404 ? "Không tìm thấy hồ sơ trong phòng khám được phép."
              : response.status === 409 ? "Hồ sơ đã thay đổi hoặc mã đã được sử dụng. Kiểm tra lại rồi thử tiếp."
                : response.status === 400 ? "Thông tin chưa hợp lệ. Kiểm tra các trường và trạng thái đã chọn."
                  : "Chưa thể hoàn tất thao tác. Vui lòng thử lại sau.");
        if (response.status === 409) startTransition(() => router.refresh());
        return;
      }
      if (resetOnSuccess) form.reset();
      setMessage(successMessage);
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
      setMessage("Mất kết nối. Kiểm tra lại danh sách trước khi thử lại để tránh tạo trùng.");
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return <form className={styles.form} onSubmit={submit}>
    <fieldset disabled={disabled || pending || refreshing}>
      {children}
      <Button type="submit" variant="primary" loading={pending || refreshing}>{submitLabel}</Button>
    </fieldset>
    {message && <p className={failed ? styles.error : styles.success} role={failed ? "alert" : "status"}>{message}</p>}
  </form>;
}

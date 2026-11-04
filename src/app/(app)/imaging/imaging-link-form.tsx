"use client";

import { Input } from "@/shared/ui";
import { OperationForm } from "./operation-form";
import { OperationPatientSelect } from "./patient-select";
import styles from "./operations.module.css";

export function ImagingLinkForm() {
  return <details className={styles.section}><summary>Liên kết phim chụp</summary>
    <OperationForm endpoint="/api/imaging/studies" submitLabel="Liên kết phim chụp" successMessage="Đã liên kết phim chụp với bệnh nhân.">
      <OperationPatientSelect purpose="imaging" />
      <label>Mã phim chụp<Input name="externalStudyId" required maxLength={128} pattern="[A-Za-z0-9._\-]+" placeholder="Mã từ hệ thống chụp phim" /></label>
      <p className={styles.hint}>Kiểm tra bệnh nhân và mã phim trước khi liên kết. Nếu chưa kết nối được nơi lưu phim, liên hệ người quản lý phòng khám.</p>
    </OperationForm>
  </details>;
}

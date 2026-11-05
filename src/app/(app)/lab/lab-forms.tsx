"use client";

import { Input, Select } from "@/shared/ui";
import { Textarea } from "@/components/ui/Textarea";
import { labNextStatuses } from "@/domains/operations/lab";
import { labStatusLabels } from "./labels";
import { OperationForm } from "../imaging/operation-form";
import { OperationPatientSelect } from "../imaging/patient-select";
import styles from "../imaging/operations.module.css";

export function CreateLabCaseForm() {
  return <details className={styles.section}><summary>Tạo ca labo</summary>
    <OperationForm endpoint="/api/lab/cases" submitLabel="Tạo ca labo" successMessage="Đã tạo ca labo.">
      <OperationPatientSelect purpose="lab" />
      <label>Nội dung công việc<Input name="title" required maxLength={200} placeholder="Ví dụ: Mão sứ răng 11" /></label>
      <label>Loại phục hình<Input name="workType" required maxLength={200} placeholder="Ví dụ: Mão sứ" /></label>
      <label>Labo thực hiện<Input name="laboratoryName" maxLength={160} /></label>
      <label>Hạn giao<Input name="dueAt" type="date" /></label>
      <label>Ghi chú<Textarea name="notes" maxLength={4000} /></label>
    </OperationForm>
  </details>;
}

export function LabCaseStatusForm({ id, status }: { id: string; status: string }) {
  const next = labNextStatuses(status);
  if (!next.length) return null;
  return <OperationForm endpoint={`/api/lab/cases/${encodeURIComponent(id)}/status`} submitLabel="Cập nhật ca labo" successMessage="Đã cập nhật trạng thái ca labo." resetOnSuccess={false}>
    <label>Trạng thái tiếp theo<Select key={status} name="status" required defaultValue="">
      <option value="">Chọn bước tiếp theo</option>
      {next.map(value => <option key={value} value={value}>{labStatusLabels[value]}</option>)}
    </Select></label>
  </OperationForm>;
}

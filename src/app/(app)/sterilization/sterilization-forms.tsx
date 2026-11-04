"use client";

import { Input, Select } from "@/shared/ui";
import { Textarea } from "@/components/ui/Textarea";
import { sterilizationNextStatuses } from "@/domains/operations/sterilization";
import { sterilizationStatusLabels } from "./labels";
import { OperationForm } from "../imaging/operation-form";
import styles from "../imaging/operations.module.css";

type Instrument = { id: string; code: string; name: string; busy: boolean };

export function SterilizationCreateForms({ instruments, hasClinic }: { instruments: Instrument[]; hasClinic: boolean }) {
  const available = instruments.filter(item => !item.busy);
  return <>
    {!hasClinic && <p className={styles.section}>Chọn một phòng khám để quản lý dụng cụ và tạo chu kỳ.</p>}
    <details className={styles.section}><summary>Thêm dụng cụ</summary>
      <OperationForm endpoint="/api/sterilization/instruments" submitLabel="Thêm dụng cụ" successMessage="Đã thêm dụng cụ." disabled={!hasClinic}>
        <label>Mã dụng cụ<Input name="code" required maxLength={200} /></label>
        <label>Tên dụng cụ<Input name="name" required maxLength={200} /></label>
        <label>Nhóm dụng cụ<Input name="category" required maxLength={200} /></label>
      </OperationForm>
    </details>
    <details className={styles.section}><summary>Tạo chu kỳ vô trùng</summary>
      <OperationForm endpoint="/api/sterilization/cycles" arrayFields={["instrumentIds"]} submitLabel="Tạo chu kỳ" successMessage="Đã tạo chu kỳ vô trùng." disabled={!hasClinic || !available.length}>
        <label>Phương pháp<Input name="method" required maxLength={200} placeholder="Ví dụ: Hấp hơi nước" /></label>
        <label>Máy thực hiện<Input name="machineName" maxLength={160} /></label>
        <fieldset className={styles.instruments}><legend>Dụng cụ trong chu kỳ</legend>
          {instruments.map(item => <label key={item.id}><input type="checkbox" name="instrumentIds" value={item.id} disabled={item.busy} />{item.code} · {item.name}{item.busy ? " · Đang trong chu kỳ khác" : ""}</label>)}
        </fieldset>
        <label>Ghi chú<Textarea name="notes" maxLength={4000} /></label>
      </OperationForm>
      {!available.length && <p className={styles.hint}>Chưa có dụng cụ sẵn sàng. Thêm dụng cụ hoặc hoàn tất chu kỳ đang giữ dụng cụ trước khi tạo mới.</p>}
    </details>
  </>;
}

export function SterilizationStatusForm({ id, status }: { id: string; status: string }) {
  const next = sterilizationNextStatuses(status);
  if (!next.length) return null;
  return <OperationForm endpoint={`/api/sterilization/cycles/${encodeURIComponent(id)}/status`} submitLabel="Cập nhật chu kỳ" successMessage="Đã cập nhật trạng thái chu kỳ." resetOnSuccess={false}>
    <label>Kết quả hoặc bước tiếp theo<Select key={status} name="status" required defaultValue="">
      <option value="">Chọn kết quả hoặc bước tiếp theo</option>
      {next.map(value => <option key={value} value={value}>{sterilizationStatusLabels[value]}</option>)}
    </Select></label>
  </OperationForm>;
}

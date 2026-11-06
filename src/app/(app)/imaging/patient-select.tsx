"use client";

import { useEffect, useState } from "react";
import { Input, Select } from "@/shared/ui";
import styles from "./operations.module.css";

type PatientOption = { id: string; fullName: string; phone: string; clinic: { name: string } };

export function OperationPatientSelect({ purpose }: { purpose: "lab" | "imaging" }) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setPatients([]);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/lab/patients", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose, query }),
        });
        if (!response.ok) throw new Error("lookup-failed");
        const body = await response.json() as { patients: PatientOption[] };
        if (!controller.signal.aborted) setPatients(body.patients);
      } catch {
        if (!controller.signal.aborted) { setFailed(true); setPatients([]); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [purpose, query]);
  return <div className={styles.patientLookup}>
    <label>Tìm bệnh nhân<Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tên hoặc số điện thoại" maxLength={120} /></label>
    <label>Bệnh nhân<Select key={query} name="patientId" aria-label="Bệnh nhân" required defaultValue="" aria-busy={loading}>
      <option value="">{loading ? "Đang tìm…" : "Chọn bệnh nhân"}</option>
      {patients.map(patient => <option key={patient.id} value={patient.id}>{patient.fullName} · {patient.phone} · {patient.clinic.name}</option>)}
    </Select></label>
    {failed ? <p role="alert">Chưa tải được bệnh nhân. Thử thay đổi từ khóa hoặc tải lại trang.</p>
      : !loading && <p className={styles.hint}>{patients.length ? "Hiển thị tối đa 50 kết quả. Nhập thêm từ khóa để tìm chính xác." : "Không có bệnh nhân phù hợp trong phòng khám được phép."}</p>}
  </div>;
}

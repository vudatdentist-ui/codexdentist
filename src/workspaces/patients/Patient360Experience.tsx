"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LanguageContext } from "@/components/AppLanguage";
import { formatVnd, type Patient } from "@/lib/data";
import type { AppSession } from "@/lib/session";
import { PatientJourneyPanel } from "@/modules/journey/PatientJourneyPanel";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import styles from "./patient-360-workspace.module.css";

const viLanguage = {
  language: "vi" as const,
  t: {
    databaseLive: "",
    demoMode: "",
  },
};

export function Patient360Experience({
  model,
  session,
}: {
  model: Patient360WorkspaceModel;
  session: AppSession;
}) {
  const selectedPatient = model.selectedPatientId
    ? model.patientWorkspace.patients.find(
        (patient) => patient.id === model.selectedPatientId,
      ) ?? null
    : null;

  return (
    <LanguageContext.Provider value={viLanguage}>
      {selectedPatient ? (
        <PatientChart model={model} patient={selectedPatient} session={session} />
      ) : (
        <PatientDirectory model={model} />
      )}
    </LanguageContext.Provider>
  );
}

function PatientDirectory({ model }: { model: Patient360WorkspaceModel }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearch(query);
  const clinicById = useMemo(
    () => new Map(model.patientWorkspace.clinics.map((clinic) => [clinic.id, clinic.name])),
    [model.patientWorkspace.clinics],
  );
  const patients = useMemo(() => {
    if (!normalizedQuery) {
      return model.patientWorkspace.patients;
    }

    return model.patientWorkspace.patients.filter((patient) =>
      [
        patient.name,
        patient.phone,
        patient.patientCode,
        patient.email,
        patient.visitReason,
        patient.city,
        patient.nationalId,
      ].some((value) => normalizeSearch(value).includes(normalizedQuery)),
    );
  }, [model.patientWorkspace.patients, normalizedQuery]);

  return (
    <div className={styles.page}>
      <header className={styles.directoryHeader}>
        <div>
          <span className={styles.eyebrow}>Bệnh nhân</span>
          <h1>Hồ sơ bệnh nhân 360</h1>
          <p>{model.patientWorkspace.patients.length} hồ sơ trong phạm vi hiện tại</p>
        </div>
        {model.patientWorkspace.canMutate && (
          <Link className={styles.secondaryAction} href="/patient-management">
            Thêm / chỉnh sửa hồ sơ
          </Link>
        )}
      </header>

      {model.patientWorkspace.message && (
        <p className={styles.notice}>{model.patientWorkspace.message}</p>
      )}

      <label className={styles.searchField}>
        <span>Tìm bệnh nhân</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tên, mã, số điện thoại, lý do khám..."
          type="search"
          value={query}
        />
      </label>

      <section className={styles.directorySection}>
        <div className={styles.sectionHeading}>
          <h2>{normalizedQuery ? "Kết quả" : "Tất cả bệnh nhân"}</h2>
          <span>{patients.length}</span>
        </div>

        {patients.length > 0 ? (
          <div className={styles.patientRows}>
            {patients.map((patient) => (
              <Link
                className={styles.patientRow}
                href={`/patients/${encodeURIComponent(patient.id)}`}
                key={patient.id}
              >
                <div className={styles.patientIdentity}>
                  <strong>{patient.name}</strong>
                  <span>
                    {patient.patientCode ? `${patient.patientCode} · ` : ""}
                    {patient.phone}
                  </span>
                </div>
                <span className={styles.rowContext}>
                  {clinicById.get(patient.clinicId) ?? patient.city}
                  {patient.visitReason ? ` · ${patient.visitReason}` : ""}
                </span>
                <span className={styles.rowState}>
                  {patient.nextVisit && patient.nextVisit !== "Not booked"
                    ? `Hẹn: ${patient.nextVisit}`
                    : patient.lastVisit && patient.lastVisit !== "No visit"
                      ? `Gần nhất: ${patient.lastVisit}`
                      : "Chưa có lịch hẹn"}
                </span>
                <span className={styles.openAction}>Mở hồ sơ →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Không tìm thấy bệnh nhân phù hợp.</p>
        )}
      </section>
    </div>
  );
}

function PatientChart({
  model,
  patient,
  session,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
  session: AppSession;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const clinicName =
    model.patientWorkspace.clinics.find((clinic) => clinic.id === patient.clinicId)
      ?.name ?? patient.city;

  useEffect(() => {
    const canonicalPath = `/patients/${encodeURIComponent(patient.id)}`;

    if (pathname === canonicalPath) {
      return;
    }

    const nextParams = new URLSearchParams(searchParamString);
    nextParams.delete("patientId");
    const query = nextParams.toString();

    router.replace(query ? `${canonicalPath}?${query}` : canonicalPath, {
      scroll: false,
    });
  }, [patient.id, pathname, router, searchParamString]);

  return (
    <div className={styles.chartPage}>
      <header className={styles.chartHeader}>
        <div className={styles.chartIdentity}>
          <Link className={styles.backLink} href="/patients">
            ← Bệnh nhân
          </Link>
          <span className={styles.eyebrow}>Hồ sơ bệnh nhân 360</span>
          <div className={styles.chartTitleRow}>
            <h1>{patient.name}</h1>
            {patient.patientCode && <span>{patient.patientCode}</span>}
          </div>
          <p>
            {patient.phone}
            {patient.age ? ` · ${patient.age} tuổi` : ""}
            {patient.gender ? ` · ${genderLabel(patient.gender)}` : ""}
            {clinicName ? ` · ${clinicName}` : ""}
          </p>
        </div>

        <div className={styles.chartFacts} aria-label="Tóm tắt bệnh nhân">
          <div>
            <span>Công nợ</span>
            <strong>{formatVnd(patient.balance)}</strong>
          </div>
          <div>
            <span>Lịch tiếp theo</span>
            <strong>{patient.nextVisit || "Chưa đặt"}</strong>
          </div>
          <div>
            <span>Đồng thuận</span>
            <strong>{patient.consent === "Granted" ? "Đã đồng ý" : "Cần cập nhật"}</strong>
          </div>
        </div>
      </header>

      <div className={styles.patientCanvas}>
        <PatientJourneyPanel
          actorName={session.fullName}
          billingWorkspace={model.billingWorkspace}
          chartSearch=""
          clinicalWorkspace={model.clinicalWorkspace}
          crmWorkspace={model.crmWorkspace}
          formsWorkspace={model.formsWorkspace}
          journeyReceipts={[]}
          journeyRecordsWorkspace={model.journeyRecordsWorkspace}
          onUpdateJourneyInvoiceAmount={() => undefined}
          onVoidJourneyInvoiceIfUnpaid={() => undefined}
          patientFilesWorkspace={model.patientFilesWorkspace}
          patientWorkspace={model.patientWorkspace}
          pharmacyWorkspace={model.pharmacyWorkspace}
          scheduleWorkspace={model.scheduleWorkspace}
          selectedPatientId={patient.id}
          servicesWorkspace={model.servicesWorkspace}
          session={session}
          settingsWorkspace={model.settingsWorkspace}
          treatmentWorkspace={model.treatmentWorkspace}
          visibleAppointments={model.scheduleWorkspace?.appointments ?? []}
          visibleClinics={model.patientWorkspace.clinics}
          visibleInvoices={model.billingWorkspace?.invoices ?? []}
          visiblePatients={model.patientWorkspace.patients}
          visiblePlans={model.treatmentWorkspace?.plans ?? []}
        />
      </div>
    </div>
  );
}

function normalizeSearch(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .trim();
}

function genderLabel(value: string) {
  switch (value.toUpperCase()) {
    case "MALE":
      return "Nam";
    case "FEMALE":
      return "Nữ";
    case "OTHER":
      return "Khác";
    default:
      return value;
  }
}

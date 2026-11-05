"use client";

import { Activity, useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppLanguage } from "@/components/AppLanguage";
import { resolvePatientSelection } from "./patient-selection-state";

function PatientRecordOwner({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const owner = root.current;
    // Activity removes effects while hidden; native media needs explicit pause.
    return () => {
      owner?.querySelectorAll<HTMLMediaElement>("video, audio").forEach(media => media.pause());
      owner?.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(dialog => dialog.close());
    };
  }, []);
  return <div ref={root} className="journey-record-owner" style={{ display: "contents" }}>{children}</div>;
}

export function PatientSelectionBoundary({ available, patientIds, selectedPatientId, children }: {
  available: boolean; patientIds: readonly string[]; selectedPatientId: string; children: ReactNode;
}) {
  const { language } = useAppLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = resolvePatientSelection({
    available,
    patientIds,
    selectedPatientId,
    requestedPatientId: searchParams.get("patientId"),
  });
  const labels = language === "vi" ? {
    unselected: "Chọn bệnh nhân để mở bệnh án",
    empty: "Chưa có bệnh nhân trong phạm vi này",
    unavailable: "Chưa tải được danh sách bệnh nhân",
    invalid: "Không thể mở hồ sơ này",
    loading: "Đang mở hồ sơ bệnh nhân",
    retry: "Tải lại",
  } : {
    unselected: "Select a patient to open their record",
    empty: "No patients in this scope",
    unavailable: "Patient list could not be loaded",
    invalid: "This patient record cannot be opened",
    loading: "Opening patient record",
    retry: "Reload",
  };
  return <>
    {state !== "ready" && <section className="panel patient-selection-notice" role="status" aria-live="polite">
      <h2>{labels[state]}</h2>
      {state === "unavailable" && <button className="secondary-button" type="button" onClick={() => router.refresh()}>{labels.retry}</button>}
    </section>}
    {/* Keep a temporary invalid URL from discarding the current record's draft.
        A different valid patient gets a fresh owner for every draft and dialog. */}
    <Activity mode={state === "ready" ? "visible" : "hidden"}>
      <PatientRecordOwner key={selectedPatientId}>{children}</PatientRecordOwner>
    </Activity>
  </>;
}

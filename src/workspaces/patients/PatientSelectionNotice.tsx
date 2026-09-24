import { useId } from "react";
import type { PatientSelectionState } from "./patient-selection-state";
import styles from "./PatientSelectionNotice.module.css";

type NoticeState = Exclude<PatientSelectionState, "ready">;
const copy: Record<"vi" | "en", Record<NoticeState, { title: string }>> = {
  vi: {
    unselected: { title: "Chọn bệnh nhân để mở bệnh án" },
    empty: { title: "Chưa có bệnh nhân trong phạm vi đang chọn" },
    invalid: { title: "Không thể mở hồ sơ này" },
    unavailable: { title: "Chưa tải được danh sách bệnh nhân" },
    loading: { title: "Đang mở bệnh án" },
  },
  en: {
    unselected: { title: "Choose a patient to open their record" },
    empty: { title: "No patients in the selected scope" },
    invalid: { title: "This record cannot be opened" },
    unavailable: { title: "The patient list could not be loaded" },
    loading: { title: "Opening the patient record" },
  },
};

export function PatientSelectionNotice({ state, language, onRetry }: { state: NoticeState; language: "vi" | "en"; onRetry: () => void }) {
  const titleId = useId();
  const message = copy[language][state];
  return <section className={styles.notice} data-patient-selection-state={state} aria-labelledby={titleId} aria-busy={state === "loading"}>
    <h2 id={titleId}>{message.title}</h2>
    {state === "unavailable" && <button type="button" className="secondary-button" onClick={onRetry}>{language === "vi" ? "Tải lại" : "Reload"}</button>}
  </section>;
}

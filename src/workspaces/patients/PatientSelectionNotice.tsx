import { useId } from "react";
import type { PatientSelectionState } from "./patient-selection-state";
import styles from "./PatientSelectionNotice.module.css";

type NoticeState = Exclude<PatientSelectionState, "ready">;
const copy: Record<"vi" | "en", Record<NoticeState, { title: string; detail: string }>> = {
  vi: {
    unselected: { title: "Chọn bệnh nhân để mở bệnh án", detail: "Tìm theo tên, số điện thoại hoặc mã bệnh nhân ở phía trên." },
    empty: { title: "Chưa có bệnh nhân trong phạm vi đang chọn", detail: "Kiểm tra phạm vi phòng khám hoặc mở danh sách bệnh nhân." },
    invalid: { title: "Không thể mở hồ sơ này", detail: "Kiểm tra phạm vi phòng khám, rồi chọn lại bệnh nhân." },
    unavailable: { title: "Chưa tải được danh sách bệnh nhân", detail: "Thử tải lại trước khi mở bệnh án." },
    loading: { title: "Đang mở bệnh án", detail: "Đang chuyển sang bệnh nhân đã chọn." },
  },
  en: {
    unselected: { title: "Choose a patient to open their record", detail: "Search by name, phone number or patient code above." },
    empty: { title: "No patients in the selected scope", detail: "Check the clinic scope or open the patient directory." },
    invalid: { title: "This record cannot be opened", detail: "Check the clinic scope, then select the patient again." },
    unavailable: { title: "The patient list could not be loaded", detail: "Try reloading before opening a record." },
    loading: { title: "Opening the patient record", detail: "Switching to the patient you selected." },
  },
};

export function PatientSelectionNotice({ state, language, onRetry }: { state: NoticeState; language: "vi" | "en"; onRetry: () => void }) {
  const titleId = useId();
  const message = copy[language][state];
  return <section className={styles.notice} data-patient-selection-state={state} aria-labelledby={titleId} aria-busy={state === "loading"}>
    <h2 id={titleId}>{message.title}</h2>
    <p>{message.detail}</p>
    {state === "unavailable" && <button type="button" className="secondary-button" onClick={onRetry}>{language === "vi" ? "Tải lại" : "Reload"}</button>}
  </section>;
}

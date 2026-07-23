"use client";

import { FileText, LockKeyhole, Printer, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  assignPatientFormAction,
  completePatientFormAction,
  createFormTemplateAction,
  voidPatientFormAction,
} from "@/app/(app)/forms/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, RecordTile, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import type { Patient } from "@/lib/data";
import type { FormsWorkspace } from "@/lib/forms-types";
import type { PatientWorkspace } from "@/lib/patient-types";

type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<Pick<Patient, "email" | "patientCode">>;

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") {
    return message;
  }

  const viMessages: Record<string, string> = {
    "Chưa tải được dữ liệu. Vui lòng thử lại sau.":
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "forms-template-saved": { vi: "Đã lưu mẫu biểu mẫu.", en: "Form template saved." },
    "forms-assigned": { vi: "Đã gửi biểu mẫu cho bệnh nhân.", en: "Patient form sent." },
    "forms-completed": { vi: "Đã hoàn tất biểu mẫu bệnh nhân.", en: "Patient form completed." },
    "forms-voided": { vi: "Đã hủy biểu mẫu bệnh nhân.", en: "Patient form voided." },
    "forms-denied": { vi: "Tài khoản này không thể thay đổi biểu mẫu bệnh nhân.", en: "This role cannot change patient forms." },
    "forms-missing": { vi: "Điền đủ trường bắt buộc của biểu mẫu.", en: "Complete the required form fields." },
    "forms-not-open": { vi: "Chỉ biểu mẫu đang mở mới có thể hoàn tất.", en: "Only open forms can be completed." },
    "forms-signature-missing": { vi: "Biểu mẫu này cần link chữ ký trước khi hoàn tất.", en: "This form requires a signature link before completion." },
    "forms-void-reason-missing": { vi: "Nhập lý do trước khi hủy biểu mẫu bệnh nhân.", en: "Enter a reason before voiding the patient form." },
    "forms-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();

  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const viStatus: Record<string, string> = {
    COMPLETED: "Đã hoàn tất",
    SENT: "Đang mở",
    VOID: "Đã hủy",
    DRAFT: "Nháp",
  };

  return language === "vi" ? viStatus[status] ?? status : status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();

  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function padCodeNumber(value: number, digits: number) {
  return String(Math.max(Math.trunc(value), 0)).padStart(digits, "0");
}

function stableNumberFromText(value: string, max: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % max;
  }

  return hash + 1;
}

function patientCodeFor(patient: Pick<Patient, "id"> & Partial<Pick<Patient, "patientCode">> | null | undefined) {
  if (!patient) {
    return "PT000000";
  }

  if (patient.patientCode) {
    return patient.patientCode;
  }

  const numericId = patient.id.match(/\d+/g)?.join("");
  const sequence = numericId ? Number(numericId.slice(-6)) : stableNumberFromText(patient.id, 999999);

  return "PT" + padCodeNumber(sequence || 0, 6);
}

function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return patientCodeFor(patient) + " - " + patient.name + " - " + patient.phone;
}

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/d/g, "d")
    .replace(/D/g, "D")
    .toLowerCase();
}

function PatientSearchCombobox({
  disabled = false,
  hideIcon = false,
  query,
  onQueryChange,
  matches,
  selectedPatient,
  placeholder,
  selectLabel,
  noResultsLabel,
  onSelect,
}: {
  disabled?: boolean;
  hideIcon?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  matches: PatientSearchRecord[];
  selectedPatient?: PatientSearchRecord | null;
  placeholder: string;
  selectLabel: string;
  noResultsLabel: string;
  onSelect: (patient: PatientSearchRecord) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeSearchText(query.trim());
  const selectedPatientLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
  const inputValue = query || selectedPatientLabel;
  const visibleMatches = normalizedQuery
    ? matches.filter((patient) => patient.id !== selectedPatient?.id).slice(0, 8)
    : [];
  const shouldShowResults = isOpen && normalizedQuery.length > 0;

  return (
    <div className="patient-search-combobox">
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true" />}
        <input
          ref={inputRef}
          aria-autocomplete="list"
          aria-expanded={shouldShowResults}
          aria-label={selectLabel}
          disabled={disabled}
          onBlur={() => setIsOpen(false)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);

            if (!query && selectedPatientLabel) {
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          placeholder={placeholder}
          value={inputValue}
        />
      </label>
      {shouldShowResults ? (
        <div className="patient-search-results" role="listbox" aria-label={selectLabel}>
          {visibleMatches.length > 0 ? (
            visibleMatches.map((patient) => (
              <button
                className="patient-search-option"
                key={patient.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(patient);
                  setIsOpen(false);
                }}
                role="option"
                type="button"
              >
                <strong>{patient.name}</strong>
                <span>
                  {patientCodeFor(patient)} - {patient.phone}
                  {patient.email ? " - " + patient.email : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="patient-search-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function FormsPanel({
  formsWorkspace,
  patientWorkspace,
  visibleClinicIds,
}: {
  formsWorkspace?: FormsWorkspace | null;
  patientWorkspace?: PatientWorkspace | null;
  visibleClinicIds: Set<string>;
}) {
  const { language } = useAppLanguage();
  const searchParams = useSearchParams();
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const patients = (
    formsWorkspace?.patients ??
    patientWorkspace?.patients.map((patient) => ({
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      clinicId: patient.clinicId,
    })) ??
    []
  ).filter((patient) => visibleClinicIds.has(patient.clinicId));
  const templates = (formsWorkspace?.templates ?? []).filter((template) => template.active);
  const patientForms = (formsWorkspace?.patientForms ?? []).filter(
    (form) => !form.clinicId || visibleClinicIds.has(form.clinicId),
  );
  const canMutate = formsWorkspace?.canMutate ?? false;
  const [formsModal, setFormsModal] = useState<"assign" | "template" | null>(null);
  const [formsSection, setFormsSection] = useState<"forms" | "templates" | "storage">("forms");
  const [completingFormId, setCompletingFormId] = useState("");
  const [printingFormTemplateId, setPrintingFormTemplateId] = useState("");
  const [printFormPatientId, setPrintFormPatientId] = useState("");
  const [assignPatientQuery, setAssignPatientQuery] = useState("");
  const [assignPatientId, setAssignPatientId] = useState("");
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [printFormPatientQuery, setPrintFormPatientQuery] = useState("");
  const [completeResponse, setCompleteResponse] = useState("");
  const [completeSignatureUrl, setCompleteSignatureUrl] = useState("");
  const [completeAttachments, setCompleteAttachments] = useState("");
  const [voidingFormId, setVoidingFormId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const completingForm =
    patientForms.find((form) => form.id === completingFormId) ?? null;
  const voidingForm =
    patientForms.find((form) => form.id === voidingFormId) ?? null;
  const printingFormTemplate =
    templates.find((template) => template.id === printingFormTemplateId) ?? null;
  const assignPatient = patients.find((patient) => patient.id === assignPatientId) ?? null;
  const assignTemplate =
    templates.find((template) => template.id === assignTemplateId) ?? templates[0] ?? null;
  const printFormPatient = patients.find((patient) => patient.id === printFormPatientId) ?? null;
  const formsPatientSearchRecords: PatientSearchRecord[] = useMemo(
    () =>
      patients.map((patient) => ({
        id: patient.id,
        name: patient.name,
        phone: patient.phone ?? "-",
      })),
    [patients],
  );
  const assignPatientMatches = useMemo(() => {
    const query = normalizeSearchText(assignPatientQuery);

    if (!query) {
      return [];
    }

    return formsPatientSearchRecords.filter((patient) =>
      normalizeSearchText(`${patientCodeFor(patient)} ${patient.name} ${patient.phone ?? ""}`).includes(query),
    );
  }, [assignPatientQuery, formsPatientSearchRecords]);
  const printPatientMatches = useMemo(() => {
    const query = normalizeSearchText(printFormPatientQuery);

    if (!query) {
      return [];
    }

    return formsPatientSearchRecords.filter((patient) =>
      normalizeSearchText(`${patientCodeFor(patient)} ${patient.name} ${patient.phone ?? ""}`).includes(query),
    );
  }, [printFormPatientQuery, formsPatientSearchRecords]);
  const text =
    language === "vi"
      ? {
          heading: "Biểu mẫu, consent form và khai báo bệnh nhân",
          assign: "Gửi biểu mẫu",
          cancel: "Hủy",
          close: "Đóng",
          completeConfirm: "Hoàn tất biểu mẫu này? Nội dung sẽ được ghi vào timeline bệnh nhân.",
          completeForm: "Hoàn tất biểu mẫu",
          createTemplate: "Tạo mẫu biểu mẫu",
          forms: "Biểu mẫu bệnh nhân",
          templates: "Thư viện biểu mẫu",
          patient: "Bệnh nhân",
          patientSearchPlaceholder: "Tìm bệnh nhân theo tên, mã, số điện thoại",
          noPatientResults: "Không có bệnh nhân phù hợp",
          selectPatientFirst: "Chọn bệnh nhân bằng ô tìm kiếm trước khi gửi biểu mẫu.",
          response: "Nội dung bệnh nhân đã điền",
          responseRequired: "Cần nhập nội dung bệnh nhân đã xác nhận.",
          complete: "Hoàn tất",
          completed: "Đã hoàn tất",
          void: "Hủy",
          voidReason: "Lý do hủy",
          voidReasonPlaceholder: "Ví dụ: gửi nhầm mẫu, bệnh nhân cần làm lại, thông tin sai...",
          open: "Đang mở",
          protected: "Bảo vệ",
          library: "Thư viện",
          template: "Mẫu",
          expires: "Hết hạn",
          type: "Loại",
          code: "Mã",
          name: "Tên",
          version: "Phiên bản",
          body: "Nội dung",
          signatureRequired: "Cần chữ ký",
          signature: "Chữ ký",
          noSignature: "Không cần chữ ký",
          print: "In",
          printTemplate: "In mẫu biểu",
          preview: "Xem trước",
          save: "Lưu",
          voidConfirm: "Hủy biểu mẫu này? Hành động sẽ được lưu audit.",
          empty: "Chưa có dữ liệu",
          formsTab: "Form bệnh nhân",
          templatesTab: "Thư viện mẫu",
          storageTab: "Lưu trữ & chữ ký",
        }
      : {
          heading: "Forms, consent, and patient intake",
          assign: "Send form",
          cancel: "Cancel",
          close: "Close",
          completeConfirm: "Complete this form? The response will be written to the patient timeline.",
          completeForm: "Complete form",
          createTemplate: "Create form template",
          forms: "Patient forms",
          templates: "Form library",
          patient: "Patient",
          patientSearchPlaceholder: "Search patient by name, code, or phone",
          noPatientResults: "No matching patients",
          selectPatientFirst: "Select a patient with search before sending the form.",
          response: "Patient response",
          responseRequired: "Enter the response the patient confirmed.",
          complete: "Complete",
          completed: "Completed",
          void: "Void",
          voidReason: "Void reason",
          voidReasonPlaceholder: "Example: wrong template sent, patient needs to redo it, incorrect information...",
          open: "Open",
          protected: "Protected",
          library: "Library",
          template: "Template",
          expires: "Expires",
          type: "Type",
          code: "Code",
          name: "Name",
          version: "Version",
          body: "Body",
          signatureRequired: "Signature required",
          signature: "Signature",
          noSignature: "No signature",
          print: "Print",
          printTemplate: "Print form template",
          preview: "Preview",
          save: "Save",
          voidConfirm: "Void this form? The action will be audit logged.",
          empty: "No records yet",
          formsTab: "Patient forms",
          templatesTab: "Template library",
          storageTab: "Storage & signatures",
        };
  const formStorageLabels =
    language === "vi"
      ? {
          attachments: "File đính kèm",
          patientFiles: "File bệnh án",
          patientFilesValue: "Ảnh/PDF qua route bảo vệ /patient-files/[fileId]",
          signature: "Link chữ ký",
          signatureValue: "Lưu signatureUrl trong PatientForm và audit khi hoàn tất",
          storagePolicy: "Chính sách file và chữ ký",
          attachmentsValue: "Lưu danh sách link/file id trong PatientForm.attachments",
        }
      : {
          attachments: "Attachments",
          patientFiles: "Patient files",
          patientFilesValue: "Images/PDF through protected /patient-files/[fileId]",
          signature: "Signature link",
          signatureValue: "Store signatureUrl on PatientForm with completion audit",
          storagePolicy: "File and signature policy",
          attachmentsValue: "Store link/file ids in PatientForm.attachments",
        };
  const openAssignFormModal = () => {
    setAssignPatientQuery("");
    setAssignPatientId("");
    setAssignTemplateId(templates[0]?.id ?? "");
    setFormsModal("assign");
  };
  const openCompleteFormModal = (form: (typeof patientForms)[number]) => {
    setCompletingFormId(form.id);
    setCompleteResponse(form.responseText ?? "");
    setCompleteSignatureUrl(form.signatureUrl ?? "");
    setCompleteAttachments(form.attachments.join(", "));
  };
  const canAssignForm = canMutate && Boolean(assignPatient) && Boolean(assignTemplate);
  const canCompleteForm =
    canMutate &&
    Boolean(completingForm) &&
    completeResponse.trim().length > 0 &&
    (!completingForm?.requiresSignature || completeSignatureUrl.trim().length > 0);
  const formsSectionTabs = [
    { key: "forms", label: text.formsTab, count: patientForms.length },
    { key: "templates", label: text.templatesTab, count: templates.length },
    { key: "storage", label: text.storageTab, count: 3 },
  ] as const;

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{language === "vi" ? "Biểu mẫu" : "Forms"}</p>
          <h2>{text.heading}</h2>
        </div>
        <SourceBadge source={formsWorkspace?.source} />
      </div>

      {(formsWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(formsWorkspace?.message, language)}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard label={text.templates} value={String(templates.length)} tone="blue" />
        <MetricCard label={text.forms} value={String(patientForms.length)} tone="teal" />
        <MetricCard
          label={text.completed}
          value={String(patientForms.filter((form) => form.status === "COMPLETED").length)}
          tone="green"
        />
        <MetricCard
          label={text.open}
          value={String(patientForms.filter((form) => form.status === "SENT").length)}
          tone="violet"
        />
      </div>

      <div className="toolbar-actions">
        <button
          className="primary-button"
          type="button"
          disabled={!canMutate || patients.length === 0 || templates.length === 0}
          onClick={openAssignFormModal}
        >
          <ShieldCheck size={16} />
          {text.assign}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!canMutate}
          onClick={() => setFormsModal("template")}
        >
          <FileText size={16} />
          {text.createTemplate}
        </button>
      </div>

      <nav className="forms-section-tabs" aria-label={text.heading}>
        {formsSectionTabs.map((tab) => (
          <button
            className={formsSection === tab.key ? "active" : ""}
            key={tab.key}
            type="button"
            onClick={() => setFormsSection(tab.key)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </nav>

      {formsModal === "assign" && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.assign} onClick={() => setFormsModal(null)}>
          <form action={assignPatientFormAction} className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setFormsModal(null)}>
            <div className="progress-modal-header">
              <div>
                <span>{text.forms}</span>
                <h3>{text.assign}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setFormsModal(null)} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <input name="patientId" type="hidden" value={assignPatient?.id ?? ""} />
            <div className="staff-form modal-form-grid">
            <div className="clinical-wide">
              <span className="field-label">{text.patient}</span>
              <PatientSearchCombobox
                disabled={!canMutate || patients.length === 0}
                hideIcon
                matches={assignPatientMatches}
                noResultsLabel={text.noPatientResults}
                onQueryChange={(value) => {
                  setAssignPatientQuery(value);
                  setAssignPatientId("");
                }}
                onSelect={(patient) => {
                  setAssignPatientId(patient.id);
                  setAssignPatientQuery("");
                }}
                placeholder={text.patientSearchPlaceholder}
                query={assignPatientQuery}
                selectedPatient={
                  assignPatient
                    ? {
                        id: assignPatient.id,
                        name: assignPatient.name,
                        phone: assignPatient.phone ?? "-",
                      }
                    : null
                }
                selectLabel={text.patient}
              />
              {!assignPatient ? (
                <small className="field-helper warning">{text.selectPatientFirst}</small>
              ) : null}
            </div>
            <label>
              {text.template}
              <select
                name="templateId"
                disabled={!canMutate || templates.length === 0}
                onChange={(event) => setAssignTemplateId(event.target.value)}
                value={assignTemplate?.id ?? ""}
                required
              >
                {templates.map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.code} v{template.version} - {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {text.expires}
              <input name="expiresAt" type="date" disabled={!canMutate} />
            </label>
            {assignTemplate ? (
              <div className="clinical-wide form-template-preview">
                <strong>{assignTemplate.name}</strong>
                <small>
                  {assignTemplate.type} · v{assignTemplate.version} ·{" "}
                  {assignTemplate.requiresSignature ? text.signatureRequired : text.noSignature}
                </small>
                <p>{assignTemplate.body ?? ""}</p>
              </div>
            ) : null}
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setFormsModal(null)}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canAssignForm}>
                <ShieldCheck size={16} />
                {text.assign}
              </button>
            </div>
          </form>
        </div>
      )}

      {formsModal === "template" && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.createTemplate} onClick={() => setFormsModal(null)}>
          <form action={createFormTemplateAction} className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setFormsModal(null)}>
            <div className="progress-modal-header">
              <div>
                <span>{text.library}</span>
                <h3>{text.createTemplate}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setFormsModal(null)} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form modal-form-grid">
            <label>
              {text.type}
              <select name="type" disabled={!canMutate} defaultValue="CONSENT">
                <option value="CONSENT">CONSENT</option>
                <option value="INTAKE">INTAKE</option>
                <option value="MEDICAL_HISTORY">MEDICAL_HISTORY</option>
                <option value="POST_OP">POST_OP</option>
                <option value="FINANCIAL_POLICY">FINANCIAL_POLICY</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </label>
            <label>
              {text.code}
              <input name="code" placeholder="CONSENT-IMPLANT" disabled={!canMutate} required />
            </label>
            <label>
              {text.name}
              <input name="name" disabled={!canMutate} required />
            </label>
            <label>
              {text.version}
              <input name="version" defaultValue="1.0" disabled={!canMutate} />
            </label>
            <label className="clinical-wide">
              {text.body}
              <textarea name="body" disabled={!canMutate} />
            </label>
            <label>
              <input name="requiresSignature" type="checkbox" defaultChecked disabled={!canMutate} />
              {text.signatureRequired}
            </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setFormsModal(null)}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canMutate}>
                <FileText size={16} />
                {text.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {printingFormTemplate && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={`${text.print} ${printingFormTemplate.name}`} onClick={() => setPrintingFormTemplateId("")}>
          <div className="progress-modal pharmacy-modal" onClick={(event) => event.stopPropagation()}>
            <div className="progress-modal-header">
              <div>
                <span>{printingFormTemplate.code} v{printingFormTemplate.version}</span>
                <h3>{text.printTemplate}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPrintingFormTemplateId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <div className="staff-form">
              <div>
                <span className="field-label">{text.patient}</span>
                <PatientSearchCombobox
                  disabled={patients.length === 0}
                  hideIcon
                  matches={printPatientMatches}
                  noResultsLabel={text.noPatientResults}
                  onQueryChange={(value) => {
                    setPrintFormPatientQuery(value);
                    setPrintFormPatientId("");
                  }}
                  onSelect={(patient) => {
                    setPrintFormPatientId(patient.id);
                    setPrintFormPatientQuery("");
                  }}
                  placeholder={text.patientSearchPlaceholder}
                  query={printFormPatientQuery}
                  selectedPatient={
                    printFormPatient
                      ? {
                          id: printFormPatient.id,
                          name: printFormPatient.name,
                          phone: printFormPatient.phone ?? "-",
                        }
                      : null
                  }
                  selectLabel={text.patient}
                />
              </div>
            </div>
            <p className="progress-modal-note">
              {language === "vi"
                ? "Nếu không chọn bệnh nhân, vùng họ tên, tuổi, điện thoại, lý do khám/chẩn đoán và địa chỉ sẽ để trống khi in."
                : "If no patient is selected, patient name, age, phone, visit reason/diagnosis, and address will be left blank on print."}
            </p>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPrintingFormTemplateId("")}>
                {text.cancel}
              </button>
              <Link
                className="primary-button"
                href={`/forms/template-print/${encodeURIComponent(printingFormTemplate.id)}${
                  printFormPatientId ? `?patientId=${encodeURIComponent(printFormPatientId)}` : ""
                }`}
                target="_blank"
                onClick={() => setPrintingFormTemplateId("")}
              >
                <Printer size={16} />
                {text.print}
              </Link>
            </div>
          </div>
        </div>
      )}

      {completingForm && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.completeForm} onClick={() => setCompletingFormId("")}>
          <form
            action={completePatientFormAction}
            className="progress-modal pharmacy-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              if (!canCompleteForm) {
                event.preventDefault();
                return;
              }

              if (!window.confirm(text.completeConfirm)) {
                event.preventDefault();
                return;
              }

              setCompletingFormId("");
            }}
          >
            <div className="progress-modal-header">
              <div>
                <span>{completingForm.formNo} · {completingForm.templateCode} v{completingForm.templateVersion}</span>
                <h3>{text.completeForm}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setCompletingFormId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <input name="patientFormId" type="hidden" value={completingForm.id} />
            <div className="staff-form modal-form-grid">
              <div className="clinical-wide form-template-preview">
                <strong>{completingForm.templateName}</strong>
                <small>
                  {completingForm.patientName} · {completingForm.templateType} ·{" "}
                  {completingForm.requiresSignature ? text.signatureRequired : text.noSignature}
                </small>
                <p>{completingForm.templateBody ?? ""}</p>
              </div>
              <label className="clinical-wide">
                {text.response}
                <textarea
                  name="responses"
                  value={completeResponse}
                  onChange={(event) => setCompleteResponse(event.target.value)}
                  disabled={!canMutate}
                  required
                />
                {!completeResponse.trim() ? (
                  <small className="field-helper warning">{text.responseRequired}</small>
                ) : null}
              </label>
              <label>
                {formStorageLabels.signature}
                <input
                  name="signatureUrl"
                  value={completeSignatureUrl}
                  onChange={(event) => setCompleteSignatureUrl(event.target.value)}
                  disabled={!canMutate}
                />
                {completingForm.requiresSignature && !completeSignatureUrl.trim() ? (
                  <small className="field-helper warning">{text.signatureRequired}</small>
                ) : null}
              </label>
              <label>
                {formStorageLabels.attachments}
                <input
                  name="attachments"
                  value={completeAttachments}
                  onChange={(event) => setCompleteAttachments(event.target.value)}
                  disabled={!canMutate}
                />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setCompletingFormId("")}>
                {text.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!canCompleteForm}>
                <ShieldCheck size={16} />
                {text.complete}
              </button>
            </div>
          </form>
        </div>
      )}

      {voidingForm && (
        <div className="progress-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.void} onClick={() => setVoidingFormId("")}>
          <form
            action={voidPatientFormAction}
            className="progress-modal pharmacy-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              if (!voidReason.trim() || !window.confirm(text.voidConfirm)) {
                event.preventDefault();
                return;
              }

              setVoidingFormId("");
            }}
          >
            <div className="progress-modal-header">
              <div>
                <span>{voidingForm.formNo}</span>
                <h3>{text.void} · {voidingForm.patientName}</h3>
              </div>
              <button className="icon-button small" type="button" onClick={() => setVoidingFormId("")} aria-label={text.close}>
                <X size={16} />
              </button>
            </div>
            <input name="patientFormId" type="hidden" value={voidingForm.id} />
            <div className="staff-form">
              <label>
                {text.voidReason}
                <textarea
                  name="voidReason"
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  placeholder={text.voidReasonPlaceholder}
                  disabled={!canMutate}
                  required
                />
                {!voidReason.trim() ? (
                  <small className="field-helper warning">{text.voidReasonPlaceholder}</small>
                ) : null}
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setVoidingFormId("")}>
                {text.cancel}
              </button>
              <button className="primary-button danger" type="submit" disabled={!canMutate || !voidReason.trim()}>
                {text.void}
              </button>
            </div>
          </form>
        </div>
      )}

      {formsSection === "forms" && (
      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={ShieldCheck} title={text.forms} action={`${patientForms.length}`} />
          <div className="invoice-list">
            {patientForms.length > 0 ? (
              patientForms.map((form) => (
                <div className="invoice-row billing-invoice-row" key={form.id}>
                  <div>
                    <strong>{form.formNo}</strong>
                    <span>
                      {form.patientName} · {form.templateName}
                    </span>
                    <small>{form.sentAt ?? form.createdAt}</small>
                    {(form.responseText || form.signatureUrl || form.attachments.length > 0) && (
                      <div className="forms-row-details">
                        {form.responseText && <small>{form.responseText}</small>}
                        {form.signatureUrl && <small>{formStorageLabels.signature}: {form.signatureUrl}</small>}
                        {form.attachments.length > 0 && (
                          <small>{formStorageLabels.attachments}: {form.attachments.join(", ")}</small>
                        )}
                      </div>
                    )}
                  </div>
                  <StatusPill status={form.status} />
                  {form.status !== "VOID" && form.status !== "COMPLETED" && (
                    <button
                      type="button"
                      disabled={!canMutate}
                      onClick={() => openCompleteFormModal(form)}
                    >
                      {text.complete}
                    </button>
                  )}
                  {form.status !== "VOID" && (
                    <button
                      type="button"
                      disabled={!canMutate}
                      onClick={() => {
                        setVoidingFormId(form.id);
                        setVoidReason("");
                      }}
                    >
                      {text.void}
                    </button>
                  )}
                </div>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>
      </section>
      )}

      {formsSection === "templates" && (
      <section className="content-grid service-management-grid">
        <section className="panel">
          <PanelHeader icon={FileText} title={text.templates} action={`${templates.length}`} />
          <div className="record-grid">
            {templates.length > 0 ? (
              templates.map((template) => (
                <article className="record-tile pharmacy-edit-tile" key={template.id}>
                  <button
                    className="icon-button small pharmacy-card-edit"
                    type="button"
                    onClick={() => {
                      setPrintingFormTemplateId(template.id);
                      setPrintFormPatientId("");
                      setPrintFormPatientQuery("");
                    }}
                    aria-label={`${language === "vi" ? "In" : "Print"} ${template.name}`}
                  >
                    <Printer size={15} />
                  </button>
                  <span>{template.code} v{template.version}</span>
                  <strong>{template.name}</strong>
                  <small>
                    {template.type} · {template.requiresSignature ? text.signature : text.noSignature}
                  </small>
                </article>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>
      </section>
      )}

      {formsSection === "storage" && (
      <section className="panel">
        <PanelHeader icon={LockKeyhole} title={formStorageLabels.storagePolicy} action={text.protected} />
        <div className="record-grid">
          <RecordTile
            title={formStorageLabels.patientFiles}
            value={formStorageLabels.patientFilesValue}
          />
          <RecordTile
            title={formStorageLabels.signature}
            value={formStorageLabels.signatureValue}
          />
          <RecordTile
            title={formStorageLabels.attachments}
            value={formStorageLabels.attachmentsValue}
          />
        </div>
      </section>
      )}
    </section>
  );
}


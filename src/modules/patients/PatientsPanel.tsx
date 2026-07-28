"use client";

import { FileText, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPatientAction,
  updatePatientAction,
  updatePatientConsentAction,
  updatePatientLeadSourceAction,
} from "@/app/(app)/patients/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { formatVnd, type Clinic, type Patient } from "@/lib/data";
import type { PatientWorkspace } from "@/lib/patient-types";
import type { AppRole } from "@/lib/permissions";

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function clinicIsActive(clinic: Pick<Clinic, "active">) {
  return clinic.active !== false;
}

function patientVisitLabel(value: string | null | undefined, language: Language) {
  if (!value || /^not booked$/i.test(value)) {
    return language === "vi" ? "Chưa có lịch hẹn" : "Not booked";
  }

  return value;
}

function workspaceMessageText(message: string | null | undefined, language: Language) {
  if (!message || language !== "vi") return message;

  const viMessages: Record<string, string> = {
    "Chưa có dữ liệu trong phạm vi hiện tại.":
      "Chưa có dữ liệu trong phạm vi hiện tại.",
  };

  return viMessages[message] ?? message;
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    "patient-created": { vi: "Đã tạo hồ sơ bệnh nhân.", en: "Patient profile created." },
    "patient-updated": { vi: "Đã cập nhật hồ sơ bệnh nhân.", en: "Patient profile updated." },
    "patient-consent-updated": { vi: "Đã cập nhật trạng thái đồng ý.", en: "Patient consent status updated." },
    "patient-source-denied": { vi: "Chỉ quản lý mới được đổi nguồn khách.", en: "Only managers can change patient lead source." },
    "patient-source-reason-required": { vi: "Cần nhập lý do đổi nguồn khách.", en: "A reason is required to change patient lead source." },
    "patient-source-unchanged": { vi: "Nguồn khách không thay đổi.", en: "Patient lead source is unchanged." },
    "patient-source-updated": { vi: "Đã cập nhật nguồn khách.", en: "Patient lead source updated." },
    "patient-denied": { vi: "Vai trò này không thể sửa hồ sơ bệnh nhân.", en: "This role cannot change patient records." },
    "patient-missing": { vi: "Cần nhập họ tên và số điện thoại.", en: "Full name and phone are required." },
    "patient-duplicate-phone": { vi: "Số điện thoại này đã được dùng cho bệnh nhân khác.", en: "Another patient already uses that phone number." },
    "patient-duplicate-national-id": { vi: "Số giấy tờ này đã được dùng cho bệnh nhân khác.", en: "Another patient already uses that national ID." },
    "patient-not-found": { vi: "Không tìm thấy bệnh nhân trong phạm vi phòng khám này.", en: "The patient could not be found in this clinic scope." },
    "patient-clinic-inactive": { vi: "Chọn chi nhánh đang hoạt động khi tạo bệnh nhân.", en: "Choose an active clinic branch for patient intake." },
    "patient-database": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };

  return notice ? notices[notice]?.[language] ?? null : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function displayStatus(status: string, language: Language) {
  const normalizedStatus = String(status ?? "").toUpperCase();
  const viStatus: Record<string, string> = {
    GRANTED: "\u0110\u00e3 \u0111\u1ed3ng \u00fd",
    PENDING: "Ch\u1edd \u0111\u1ed3ng \u00fd",
    REVOKED: "\u0110\u00e3 thu h\u1ed3i",
    EXPIRED: "H\u1ebft h\u1ea1n",
  };
  const enStatus: Record<string, string> = {
    GRANTED: "Granted",
    PENDING: "Pending",
    REVOKED: "Revoked",
    EXPIRED: "Expired",
  };

  return language === "vi"
    ? viStatus[normalizedStatus] ?? status
    : enStatus[normalizedStatus] ?? status;
}

function normalizePhoneForDuplicate(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
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

function patientCodeFor(patient: Pick<Patient, "id" | "patientCode"> | null | undefined) {
  if (!patient) return "PT000000";
  if (patient.patientCode) return patient.patientCode;
  const numericId = patient.id.match(/\d+/g)?.join("");
  const sequence = numericId ? Number(numericId.slice(-6)) : stableNumberFromText(patient.id, 999999);
  return `PT${padCodeNumber(sequence || 0, 6)}`;
}

function patientGenderLabel(gender: string | null | undefined, language: Language) {
  const normalizedGender = String(gender ?? "UNKNOWN").toUpperCase();
  if (normalizedGender === "FEMALE") return language === "vi" ? "Nữ" : "Female";
  if (normalizedGender === "MALE") return language === "vi" ? "Nam" : "Male";
  if (normalizedGender === "OTHER") return language === "vi" ? "Khác" : "Other";
  return language === "vi" ? "Chưa rõ" : "Unknown";
}

function patientLeadSourceOptions(language: Language) {
  return [
    { value: "WALK_IN", label: language === "vi" ? "Vãng lai" : "Walk-in" },
    { value: "FACEBOOK_ADS", label: "Facebook Ads" },
    { value: "GOOGLE_ADS", label: "Google Ads" },
    { value: "TIKTOK", label: "TikTok" },
    { value: "SOCIAL", label: language === "vi" ? "Social / cộng đồng" : "Social / community" },
    { value: "TELESALE", label: "Telesale" },
    { value: "WEBSITE", label: "Website" },
    { value: "ZALO", label: "Zalo" },
    { value: "PATIENT_REFERRAL", label: language === "vi" ? "Bệnh nhân giới thiệu" : "Patient referral" },
    { value: "STAFF_REFERRAL", label: language === "vi" ? "Nhân sự giới thiệu" : "Staff referral" },
    { value: "PARTNER", label: language === "vi" ? "Đối tác" : "Partner" },
    { value: "OTHER", label: language === "vi" ? "Khác" : "Other" },
  ];
}

function patientLeadSourceLabel(source: string | null | undefined, language: Language) {
  const normalizedSource = String(source ?? "WALK_IN").toUpperCase();
  return patientLeadSourceOptions(language).find((option) => option.value === normalizedSource)?.label ?? normalizedSource;
}
export function PatientsPanel({
  patientWorkspace,
  role,
  text,
  visibleClinics,
  visiblePatients,
}: {
  patientWorkspace?: PatientWorkspace | null;
  role: AppRole;
  text: Record<string, string>;
  visibleClinics: Clinic[];
  visiblePatients: Patient[];
}) {
  const { language } = useAppLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPatientId = searchParams.get("patientId") ?? "";
  const activeVisibleClinics = useMemo(
    () => visibleClinics.filter(clinicIsActive),
    [visibleClinics],
  );
  const activeVisibleClinicIds = useMemo(
    () => new Set(activeVisibleClinics.map((clinic) => clinic.id)),
    [activeVisibleClinics],
  );
  const operationalPatients = useMemo(
    () => visiblePatients.filter((patient) => activeVisibleClinicIds.has(patient.clinicId)),
    [activeVisibleClinicIds, visiblePatients],
  );
  const [selectedPatientId, setSelectedPatientId] = useState(
    operationalPatients.some((patient) => patient.id === requestedPatientId)
      ? requestedPatientId
      : "",
  );
  const [appliedPatientUrlId, setAppliedPatientUrlId] = useState(requestedPatientId);
  const [createPatientModalOpen, setCreatePatientModalOpen] = useState(false);
  const [editPatientModalOpen, setEditPatientModalOpen] = useState(false);
  const patientDetailRef = useRef<HTMLElement>(null);
  const [createPatientPhone, setCreatePatientPhone] = useState("");
  const [createPatientEmail, setCreatePatientEmail] = useState("");
  const selectedPatient =
    operationalPatients.find((patient) => patient.id === selectedPatientId) ?? null;
  const canMutate = patientWorkspace?.canMutate ?? false;
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const formClinics = patientWorkspace?.clinics.filter(
    (clinic) => activeVisibleClinicIds.has(clinic.id) && clinicIsActive(clinic),
  );
  const formReady = Boolean(canMutate && formClinics?.length);
  const canGovernLeadSource =
    Boolean(patientWorkspace?.canMutate) &&
    ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"].includes(role);
  const leadSourceOptions = patientLeadSourceOptions(language);
  const duplicateCreatePatient = operationalPatients.find((patient) => {
    const samePhone =
      createPatientPhone.trim() &&
      normalizePhoneForDuplicate(patient.phone) ===
        normalizePhoneForDuplicate(createPatientPhone);
    const sameEmail =
      createPatientEmail.trim() &&
      patient.email?.toLowerCase() === createPatientEmail.trim().toLowerCase();

    return samePhone || sameEmail;
  });
  const closeCreatePatientModal = () => {
    setCreatePatientModalOpen(false);
    setCreatePatientPhone("");
    setCreatePatientEmail("");
  };
  const selectPatient = (patientId: string) => {
    setSelectedPatientId(patientId);
    setEditPatientModalOpen(false);
    router.replace(`/patients?patientId=${encodeURIComponent(patientId)}`, {
      scroll: false,
    });
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 760px)").matches) {
        patientDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  useEffect(() => {
    if (operationalPatients.length === 0) {
      if (selectedPatientId) {
        setSelectedPatientId("");
      }

      return;
    }

    if (requestedPatientId !== appliedPatientUrlId) {
      setAppliedPatientUrlId(requestedPatientId);

      if (
        requestedPatientId &&
        operationalPatients.some((patient) => patient.id === requestedPatientId)
      ) {
        setSelectedPatientId(requestedPatientId);
        return;
      }
    }

    if (
      selectedPatientId &&
      !operationalPatients.some((patient) => patient.id === selectedPatientId)
    ) {
      setSelectedPatientId("");
    }
  }, [appliedPatientUrlId, operationalPatients, requestedPatientId, selectedPatientId]);

  return (
    <section className="view-stack">
      <div className="toolbar">
        <div>
          <p className="eyebrow">{text.registry}</p>
          <h2>{text.heading}</h2>
        </div>
        <SourceBadge source={patientWorkspace?.source} />
      </div>

      {(patientWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(patientWorkspace?.message, language)}
        </div>
      )}

      <div className="service-action-row">
        <button
          className="primary-button"
          type="button"
          disabled={!canMutate}
          onClick={() => {
            setCreatePatientPhone("");
            setCreatePatientEmail("");
            setCreatePatientModalOpen(true);
          }}
        >
          <UsersRound size={16} />
          {text.createPatient}
        </button>
      </div>

      {createPatientModalOpen && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={text.newPatient}
          onClick={closeCreatePatientModal}
        >
          <form
            action={createPatientAction}
            className="progress-modal patient-create-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={closeCreatePatientModal}
          >
            <div className="progress-modal-header">
              <div>
                <span>{text.frontDesk}</span>
                <h3>{text.newPatient}</h3>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={closeCreatePatientModal}
                aria-label={language === "vi" ? "Đóng" : "Close"}
              >
                <X size={16} />
              </button>
            </div>
            <div className="patient-form modal-form-grid">
              <label>
                {text.clinic}
                <select name="clinicId" disabled={!formReady} required>
                  {formClinics?.map((clinic) => (
                    <option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text.fullName}
                <input name="fullName" disabled={!formReady} required />
              </label>
              <label>
                {text.leadSource}
                <select name="leadSource" defaultValue="WALK_IN" disabled={!formReady} required>
                  {leadSourceOptions.map((source) => (
                    <option value={source.value} key={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text.phone}
                <input
                  name="phone"
                  disabled={!formReady}
                  onChange={(event) => setCreatePatientPhone(event.target.value)}
                  required
                  value={createPatientPhone}
                />
              </label>
              <label>
                {text.email}
                <input
                  name="email"
                  type="email"
                  disabled={!formReady}
                  onChange={(event) => setCreatePatientEmail(event.target.value)}
                  value={createPatientEmail}
                />
              </label>
              {duplicateCreatePatient ? (
                <div className="patient-wide field-helper warning">
                  {text.duplicateContactWarning} {duplicateCreatePatient.name} ·{" "}
                  {patientCodeFor(duplicateCreatePatient)}
                </div>
              ) : null}
              <label>
                {text.gender}
                <select name="gender" defaultValue="UNKNOWN" disabled={!formReady}>
                  <option value="UNKNOWN">{text.unknown}</option>
                  <option value="FEMALE">{text.female}</option>
                  <option value="MALE">{text.male}</option>
                  <option value="OTHER">{language === "vi" ? "Khác" : "Other"}</option>
                </select>
              </label>
              <label>
                {text.dob}
                <input name="dateOfBirth" type="date" disabled={!formReady} />
              </label>
              <label>
                {text.guardian}
                <input name="guardianName" disabled={!formReady} />
              </label>
              <label>
                {text.nationalId}
                <input name="nationalId" disabled={!formReady} />
              </label>
              <label className="patient-wide">
                {text.address}
                <input name="address" disabled={!formReady} />
              </label>
              <label className="patient-wide">
                {text.visitReason}
                <input
                  name="visitReason"
                  placeholder={text.visitReasonPlaceholder}
                  disabled={!formReady}
                />
              </label>
              <label className="patient-wide">
                {text.medicalAlerts}
                <input
                  name="medicalAlerts"
                  placeholder={text.medicalAlertsPlaceholder}
                  disabled={!formReady}
                />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeCreatePatientModal}
              >
                {language === "vi" ? "Hủy" : "Cancel"}
              </button>
              <button className="primary-button" type="submit" disabled={!formReady}>
                <UsersRound size={16} />
                {text.createPatient}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="content-grid patient-layout">
        <section className="panel">
          <PanelHeader icon={UsersRound} title={text.patientRegistry} action={text.live} />
          <div className="table-list">
            {operationalPatients.length > 0 ? (
              operationalPatients.map((patient) => (
                <button
                  className={
                    selectedPatient?.id === patient.id ? "table-row active" : "table-row"
                  }
                  key={patient.id}
                  onClick={() => selectPatient(patient.id)}
                  type="button"
                >
                  <span>
                    <strong>{patient.name}</strong>
                    <small>
                      {patientCodeFor(patient)} · {patient.phone} · {patient.city}
                    </small>
                  </span>
                  <span>{patientVisitLabel(patient.nextVisit, language)}</span>
                  <span>{formatVnd(patient.balance)}</span>
                </button>
              ))
            ) : (
              <EmptyState label={text.empty} />
            )}
          </div>
        </section>

        <section
          className="panel patient-card"
          key={selectedPatient?.id ?? "empty"}
          ref={patientDetailRef}
        >
          {selectedPatient ? (
            <>
              <PanelHeader
                icon={FileText}
                title={selectedPatient.name}
                action={patientCodeFor(selectedPatient)}
              />

              <div className="patient-profile-strip">
                <div>
                  <span>{text.phone}</span>
                  <strong>{selectedPatient.phone}</strong>
                </div>
                <div>
                  <span>{text.age}</span>
                  <strong>{selectedPatient.age || text.unknown}</strong>
                </div>
                <div>
                  <span>{text.gender}</span>
                  <strong>{patientGenderLabel(selectedPatient.gender, language)}</strong>
                </div>
                <div>
                  <span>{text.leadSource}</span>
                  <strong>{patientLeadSourceLabel(selectedPatient.leadSource, language)}</strong>
                </div>
                <div>
                  <span>{text.consent}</span>
                  <strong>{displayStatus(selectedPatient.consent, language)}</strong>
                </div>
                <div>
                  <span>{text.balance}</span>
                  <strong>{formatVnd(selectedPatient.balance)}</strong>
                </div>
              </div>

              {selectedPatient.flags.length > 0 ? (
                <div className="flag-list patient-flag-list">
                  {selectedPatient.flags.map((flag) => (
                    <span key={flag}>{flag}</span>
                  ))}
                </div>
              ) : null}

              <div className="patient-operations">
                <div className="chart-header">
                  <strong>{text.operationSummary}</strong>
                  <span>{text.profile}</span>
                </div>
                <div className="patient-operation-strip">
                  <span>
                    <span>{text.lastVisit}</span>
                    <strong>{selectedPatient.lastVisit || text.unknown}</strong>
                  </span>
                  <span>
                    <span>{text.nextVisit}</span>
                    <strong>{patientVisitLabel(selectedPatient.nextVisit, language)}</strong>
                  </span>
                  <span>
                    <span>{text.treatmentProgress}</span>
                    <strong>{selectedPatient.treatmentProgress}%</strong>
                  </span>
                  <span>
                    <span>{text.balance}</span>
                    <strong>{formatVnd(selectedPatient.balance)}</strong>
                  </span>
                </div>
                <div className="patient-quick-actions" aria-label={text.quickActions}>
                  <Link
                    className="secondary-button"
                    href={`/journey?patientId=${encodeURIComponent(selectedPatient.id)}`}
                  >
                    {text.openJourney}
                  </Link>
                  <Link
                    className="secondary-button"
                    href={`/billing?patientId=${encodeURIComponent(selectedPatient.id)}`}
                  >
                    {text.openBilling}
                  </Link>
                  <Link
                    className="secondary-button"
                    href={`/schedule?patientId=${encodeURIComponent(selectedPatient.id)}`}
                  >
                    {text.openSchedule}
                  </Link>
                  <button
                    className="primary-button patient-edit-action"
                    type="button"
                    disabled={!formReady}
                    onClick={() => setEditPatientModalOpen(true)}
                  >
                    <FileText size={16} />
                    {text.editProfile}
                  </button>
                </div>
              </div>

              <details className="patient-secondary-details">
                <summary>
                  <strong>{text.consent}</strong>
                  <span>
                    {text.consentVersion} {selectedPatient.consentVersion ?? "none"} ·{" "}
                    {text.consentSigned} {selectedPatient.consentSignedAt ?? text.noConsentDate}
                  </span>
                </summary>
                <div className="consent-actions">
                  <form action={updatePatientConsentAction}>
                    <input name="patientId" type="hidden" value={selectedPatient.id} />
                    <input name="status" type="hidden" value="GRANTED" />
                    <button type="submit" disabled={!formReady}>
                      {text.grantConsent}
                    </button>
                  </form>
                  <form action={updatePatientConsentAction}>
                    <input name="patientId" type="hidden" value={selectedPatient.id} />
                    <input name="status" type="hidden" value="EXPIRED" />
                    <button type="submit" disabled={!formReady}>
                      {text.needsRenewal}
                    </button>
                  </form>
                </div>
                {selectedPatient.consentHistory?.length ? (
                  <div className="patient-consent-history">
                    <strong>{text.consentHistory}</strong>
                    <div className="table-list compact">
                      {selectedPatient.consentHistory.map((consent) => (
                        <div className="table-row" key={consent.id}>
                          <span>
                            <strong>{displayStatus(consent.status, language)}</strong>
                            <small>
                              {text.consentVersion} {consent.version} ·{" "}
                              {text.consentChannel} {consent.channel}
                            </small>
                          </span>
                          <span>
                            {text.consentRecorded} {consent.recordedAt}
                          </span>
                          <span>
                            {text.consentSigned} {consent.signedAt ?? text.noConsentDate}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </details>

              {editPatientModalOpen ? (
                <div
                  className="progress-modal-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-label={text.editProfile}
                  onClick={() => setEditPatientModalOpen(false)}
                >
                  <div
                    className="progress-modal patient-profile-modal"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="progress-modal-header">
                      <div>
                        <span>{patientCodeFor(selectedPatient)}</span>
                        <h3>{text.editProfile}</h3>
                      </div>
                      <button
                        className="icon-button small"
                        type="button"
                        onClick={() => setEditPatientModalOpen(false)}
                        aria-label={language === "vi" ? "Đóng" : "Close"}
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <form
                      action={updatePatientLeadSourceAction}
                      className="patient-edit-form patient-source-form"
                      onSubmit={() => setEditPatientModalOpen(false)}
                    >
                      <input name="patientId" type="hidden" value={selectedPatient.id} />
                      <label>
                        {text.leadSourceGovernance}
                        <select
                          name="leadSource"
                          defaultValue={selectedPatient.leadSource ?? "WALK_IN"}
                          disabled={!canGovernLeadSource}
                        >
                          {leadSourceOptions.map((source) => (
                            <option value={source.value} key={source.value}>
                              {source.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {text.leadSourceReason}
                        <input
                          name="reason"
                          placeholder={text.leadSourceReasonPlaceholder}
                          disabled={!canGovernLeadSource}
                          required
                        />
                      </label>
                      <button className="secondary-button" type="submit" disabled={!canGovernLeadSource}>
                        {text.saveLeadSource}
                      </button>
                      <small>{text.leadSourceLocked}</small>
                    </form>

                    <form
                      action={updatePatientAction}
                      className="patient-edit-form"
                      onSubmit={() => setEditPatientModalOpen(false)}
                    >
                      <input name="patientId" type="hidden" value={selectedPatient.id} />
                      <label>
                        {text.clinic}
                        <select
                          name="clinicId"
                          defaultValue={selectedPatient.clinicId}
                          disabled={!formReady}
                          required
                        >
                          {formClinics?.map((clinic) => (
                            <option value={clinic.id} key={clinic.id}>
                              {clinic.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {text.fullName}
                        <input
                          name="fullName"
                          defaultValue={selectedPatient.name}
                          disabled={!formReady}
                          required
                        />
                      </label>
                      <label>
                        {text.phone}
                        <input
                          name="phone"
                          defaultValue={selectedPatient.phone}
                          disabled={!formReady}
                          required
                        />
                      </label>
                      <label>
                        {text.email}
                        <input
                          name="email"
                          type="email"
                          defaultValue={selectedPatient.email ?? ""}
                          disabled={!formReady}
                        />
                      </label>
                      <label>
                        {text.gender}
                        <select
                          name="gender"
                          defaultValue={selectedPatient.gender ?? "UNKNOWN"}
                          disabled={!formReady}
                        >
                          <option value="UNKNOWN">{text.unknown}</option>
                          <option value="FEMALE">{text.female}</option>
                          <option value="MALE">{text.male}</option>
                          <option value="OTHER">{language === "vi" ? "Khác" : "Other"}</option>
                        </select>
                      </label>
                      <label>
                        {text.dob}
                        <input
                          name="dateOfBirth"
                          type="date"
                          defaultValue={selectedPatient.dateOfBirth ?? ""}
                          disabled={!formReady}
                        />
                      </label>
                      <label>
                        {text.guardian}
                        <input
                          name="guardianName"
                          defaultValue={selectedPatient.guardianName ?? ""}
                          disabled={!formReady}
                        />
                      </label>
                      <label>
                        {text.nationalId}
                        <input
                          name="nationalId"
                          defaultValue={selectedPatient.nationalId ?? ""}
                          disabled={!formReady}
                        />
                      </label>
                      <label>
                        {text.address}
                        <input
                          name="address"
                          defaultValue={selectedPatient.address ?? ""}
                          disabled={!formReady}
                        />
                      </label>
                      <label className="patient-wide">
                        {text.visitReason}
                        <textarea
                          name="visitReason"
                          defaultValue={selectedPatient.visitReason ?? ""}
                          placeholder={text.visitReasonPlaceholder}
                          disabled={!formReady}
                        />
                      </label>
                      <label className="patient-wide">
                        {text.medicalAlerts}
                        <textarea
                          name="medicalAlerts"
                          defaultValue={selectedPatient.flags.join(", ")}
                          disabled={!formReady}
                        />
                      </label>
                      <div className="progress-modal-actions patient-wide">
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setEditPatientModalOpen(false)}
                        >
                          {language === "vi" ? "Hủy" : "Cancel"}
                        </button>
                        <button className="primary-button" type="submit" disabled={!formReady}>
                          {text.saveProfile}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              label={
                operationalPatients.length > 0
                  ? language === "vi"
                    ? "Chọn một bệnh nhân trong danh sách để xem hồ sơ."
                    : "Select a patient from the list to view the profile."
                  : text.empty
              }
            />
          )}
        </section>
      </section>

    </section>
  );
}

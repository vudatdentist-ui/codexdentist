"use client";

import { CalendarDays, Inbox, Search, Stethoscope, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelAppointmentAction, createAppointmentAction, updateAppointmentStatusAction, updateChairOperationalStatusAction, updateProviderOperationalStatusAction } from "@/app/(app)/schedule/actions";
import { useAppLanguage, type Language } from "@/components/AppLanguage";
import { visibleActionNoticeParam } from "@/lib/action-notices";
import { EmptyState, MetricCard, PanelHeader, StatusPill as BaseStatusPill } from "@/components/suite-primitives";
import { type Appointment, type Clinic, type Patient } from "@/lib/data";
import type { ScheduleWorkspace } from "@/lib/schedule-types";

const scheduleText = {
  vi: {
    arrive: "Đã đến",
    available: "Trống",
    cancel: "Hủy",
    chair: "Ghế",
    clinic: "Phòng khám",
    clinicId: "Phòng khám",
    createBooking: "Tạo lịch hẹn",
    date: "Ngày",
    done: "Hoàn tất",
    duration: "Phút",
    patient: "Bệnh nhân",
    provider: "Bác sĩ",
    providerFilter: "Bác sĩ",
    reason: "Lý do khám",
    reasonPlaceholder: "Khám, lấy cao răng, tư vấn implant",
    scheduleView: "Chế độ xem lịch",
    start: "Bắt đầu",
    statusFilter: "Trạng thái",
    time: "Giờ",
  },
  en: {
    arrive: "Arrive",
    available: "Available",
    cancel: "Cancel",
    chair: "Chair",
    clinic: "Clinic",
    clinicId: "Clinic",
    createBooking: "Create booking",
    date: "Date",
    done: "Done",
    duration: "Minutes",
    patient: "Patient",
    provider: "Provider",
    providerFilter: "Provider",
    reason: "Reason",
    reasonPlaceholder: "Exam, cleaning, implant consult",
    scheduleView: "Schedule view",
    start: "Start",
    statusFilter: "Status",
    time: "Time",
  },
};

const statusText: Record<Language, Record<string, string>> = {
  vi: {
    Requested: "Cần xác nhận",
    Confirmed: "Đã xác nhận",
    Arrived: "Đã đến",
    "In chair": "Đang trên ghế",
    Completed: "Hoàn tất",
    "No-show": "Không đến",
    Cancelled: "Đã hủy",
  },
  en: {},
};

function displayStatus(status: string, language: Language) {
  return statusText[language][status] ?? status;
}

function StatusPill({ status }: { status: string }) {
  const { language } = useAppLanguage();
  return <BaseStatusPill label={displayStatus(status, language)} status={status} />;
}

function SourceBadge({ source }: { source?: "database" | "demo" }) {
  const { t } = useAppLanguage();

  return (
    <span className={source === "database" ? "source-badge live" : "source-badge demo"}>
      {source === "database" ? t.databaseLive : t.demoMode}
    </span>
  );
}

function noticeText(notice: string | null, language: Language) {
  const notices: Record<string, Record<Language, string>> = {
    created: { vi: "Đã tạo lịch hẹn.", en: "Booking created." },
    updated: { vi: "Đã cập nhật lịch hẹn.", en: "Appointment updated." },
    cancelled: { vi: "Đã hủy lịch hẹn.", en: "Appointment cancelled." },
    conflict: { vi: "Ghế hoặc bác sĩ đã có lịch trong khung giờ này.", en: "Chair or provider is already booked." },
    "database-unavailable": { vi: "Chưa lưu được thay đổi. Vui lòng thử lại sau.", en: "The change could not be saved. Please try again." },
  };
  return notice ? notices[notice]?.[language] ?? notice : null;
}

function useNoticeText(notice: string | null) {
  const { language } = useAppLanguage();
  return noticeText(notice, language);
}

function workspaceMessageText(message: string | null | undefined, _language: Language) {
  return message;
}

function clinicIsActive(clinic: Pick<Clinic, "active">) {
  return clinic.active !== false;
}

function normalizeSearchText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
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

type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> & Partial<Pick<Patient, "address" | "age" | "city" | "consent" | "email" | "flags" | "gender" | "guardianName" | "leadSource" | "nationalId" | "patientCode" | "visitReason">>;

function patientSearchDisplayLabel(patient: PatientSearchRecord) {
  return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`;
}

function PatientSearchCombobox({
  disabled = false,
  hideIcon = false,
  matches,
  noResultsLabel,
  onQueryChange,
  onSelect,
  placeholder,
  query,
  selectedPatient,
  selectLabel,
}: {
  disabled?: boolean;
  hideIcon?: boolean;
  matches: PatientSearchRecord[];
  noResultsLabel: string;
  onQueryChange: (value: string) => void;
  onSelect: (patient: PatientSearchRecord) => void;
  placeholder: string;
  query: string;
  selectedPatient?: PatientSearchRecord | null;
  selectLabel: string;
}) {
  const showDropdown = !disabled && query.trim().length > 0 && !selectedPatient;
  return (
    <div className="patient-search-combobox">
      {!hideIcon ? <Search size={15} aria-hidden="true" /> : null}
      <input
        aria-label={selectLabel}
        disabled={disabled}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={selectedPatient ? patientSearchDisplayLabel(selectedPatient) : query}
      />
      {selectedPatient && !disabled ? (
        <button aria-label="Clear patient" type="button" onClick={() => onQueryChange("")}>
          <X size={14} />
        </button>
      ) : null}
      {showDropdown ? (
        <div className="patient-search-dropdown" role="listbox">
          {matches.length > 0 ? (
            matches.slice(0, 8).map((patient) => (
              <button key={patient.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(patient)}>
                <strong>{patientSearchDisplayLabel(patient)}</strong>
                <span>{[patient.email, patient.address, patient.city].filter(Boolean).join(" ? ")}</span>
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

function patientMatchesExactSelectorSearch(patient: PatientSearchRecord, query: string) {
  if (!query) return true;
  return [patientCodeFor(patient), patient.name, patient.phone, patient.email, patient.nationalId, patient.address, patient.city]
    .filter(Boolean)
    .some((value) => normalizeSearchText(value).includes(query));
}

export function ScheduleBoard({
  scheduleWorkspace,
  visibleAppointments,
  visibleClinics,
}: {
  scheduleWorkspace?: ScheduleWorkspace | null;
  visibleAppointments: Appointment[];
  visibleClinics: Clinic[];
}) {
  const { language } = useAppLanguage();
  const text = scheduleText[language];
  const searchParams = useSearchParams();
  const labels =
    language === "vi"
      ? {
          actions: "Thao tác",
          allClinics: "Tất cả chi nhánh",
          allProviders: "Tất cả bác sĩ",
          allStatuses: "Tất cả trạng thái",
          availabilityHint: "Mở khi cần điều phối ghế hoặc trạng thái bác sĩ.",
          booked: "Lịch hẹn",
          bookingDisabled: "Chọn bệnh nhân và đủ dữ liệu phòng khám/bác sĩ để tạo lịch.",
          busyAction: "Bận",
          busy: "Đang bận",
          chairBoard: "Trạng thái ghế",
          chairSummary: "ghế sẵn sàng",
          chairReady: "Ghế đã sẵn sàng",
          confirm: "Xác nhận",
          confirmCancel: "Bạn chắc chắn muốn hủy lịch hẹn này?",
          confirmNoShow: "Bạn chắc chắn muốn chuyển lịch hẹn này thành no-show?",
          createTitle: "Tạo lịch nhanh",
          dateFrom: "Từ ngày",
          dateTo: "Đến ngày",
          dispatchTitle: "Danh sách lịch hẹn",
          doctorBoard: "Bác sĩ / trợ thủ",
          inChairWithSeat: "Vào ghế",
          late: "Trễ hẹn",
          noShow: "No-show",
          noMatchingPatients: "Không có bệnh nhân phù hợp",
          openBilling: "Thanh toán",
          openChart: "Bệnh án",
          patientSearchPlaceholder: "Tìm bệnh nhân theo tên, SĐT, mã hồ sơ...",
          providerSummary: "nhân sự sẵn sàng",
          presetCustom: "Tùy chọn",
          presetLastMonth: "Tháng trước",
          presetLastWeek: "Tuần trước",
          presetThisMonth: "Tháng này",
          presetThisWeek: "Tuần này",
          presetToday: "Hôm nay",
          quickRange: "Khoảng nhanh",
          ready: "Sẵn sàng",
          readyAction: "Sẵn sàng",
          requested: "Cần xác nhận",
          selectedDay: "Ngày làm việc",
          selectChair: "Chọn ghế",
          selectPatientRequired: "Chọn bệnh nhân từ danh sách gợi ý để bật nút tạo lịch.",
          status: "Trạng thái",
          timelineHint: "Mặc định xem hôm nay; có thể chọn khoảng ngày để rà lịch hẹn và điều phối bệnh nhân.",
          waiting: "Đang chờ",
        }
      : {
          actions: "Actions",
          allClinics: "All clinics",
          allProviders: "All providers",
          allStatuses: "All statuses",
          availabilityHint: "Open only when dispatching chairs or provider status.",
          booked: "Booked",
          bookingDisabled: "Select a patient and make sure clinic/provider data is available.",
          busyAction: "Busy",
          busy: "Busy",
          chairBoard: "Chair status",
          chairSummary: "chairs ready",
          chairReady: "Chair ready",
          confirm: "Confirm",
          confirmCancel: "Are you sure you want to cancel this appointment?",
          confirmNoShow: "Are you sure you want to mark this appointment as no-show?",
          createTitle: "Quick booking",
          dateFrom: "From",
          dateTo: "To",
          dispatchTitle: "Appointment list",
          doctorBoard: "Doctors / assistants",
          inChairWithSeat: "Seat patient",
          late: "Late",
          noShow: "No-show",
          noMatchingPatients: "No matching patients",
          openBilling: "Billing",
          openChart: "Chart",
          patientSearchPlaceholder: "Search patient by name, phone, chart ID...",
          providerSummary: "staff ready",
          presetCustom: "Custom",
          presetLastMonth: "Last month",
          presetLastWeek: "Last week",
          presetThisMonth: "This month",
          presetThisWeek: "This week",
          presetToday: "Today",
          quickRange: "Quick range",
          ready: "Ready",
          readyAction: "Ready",
          requested: "Needs confirmation",
          selectedDay: "Work date",
          selectChair: "Select chair",
          selectPatientRequired: "Select a patient from the suggestions to enable booking.",
          status: "Status",
          timelineHint: "Defaults to today; choose a date range to review and dispatch appointments.",
          waiting: "Waiting",
        };
  const activeVisibleClinics = useMemo(
    () => visibleClinics.filter(clinicIsActive),
    [visibleClinics],
  );
  const visibleClinicIds = useMemo(
    () => new Set(activeVisibleClinics.map((clinic) => clinic.id)),
    [activeVisibleClinics],
  );
  const canMutate = scheduleWorkspace?.canMutate ?? false;
  const notice = useNoticeText(visibleActionNoticeParam(searchParams.get("notice")));
  const requestedPatientId = searchParams.get("patientId") ?? "";
  const formClinics = scheduleWorkspace?.clinics.filter(
    (clinic) => visibleClinicIds.has(clinic.id) && clinicIsActive(clinic),
  );
  const formPatients = scheduleWorkspace?.patients ?? [];
  const formProviders = scheduleWorkspace?.providers.filter((provider) =>
    provider.clinicIds.some((clinicId) => visibleClinicIds.has(clinicId)),
  );
  const formChairs = scheduleWorkspace?.chairs.filter((chair) =>
    visibleClinicIds.has(chair.clinicId),
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const scheduleRangePresets = [
    { key: "today", label: labels.presetToday },
    { key: "this-week", label: labels.presetThisWeek },
    { key: "last-week", label: labels.presetLastWeek },
    { key: "this-month", label: labels.presetThisMonth },
    { key: "last-month", label: labels.presetLastMonth },
    { key: "custom", label: labels.presetCustom },
  ] as const;
  const requestedClinicParam = searchParams.get("clinicId") ?? "";
  const requestedClinicFilter =
    requestedClinicParam === "all"
      ? "all"
      : visibleClinicIds.has(requestedClinicParam)
        ? requestedClinicParam
        : "all";
  const requestedDate = searchParams.get("date") ?? today;
  const requestedStartDate = searchParams.get("dateFrom") ?? requestedDate;
  const requestedEndDate = searchParams.get("dateTo") ?? requestedStartDate;
  const requestedProviderFilter = searchParams.get("providerId") ?? "all";
  const requestedStatusFilter = searchParams.get("status") ?? "all";
  const initialCreateClinicId =
    requestedClinicFilter !== "all"
      ? requestedClinicFilter
      : activeVisibleClinics[0]?.id ?? "";
  const [selectedStartDate, setSelectedStartDate] = useState(requestedStartDate);
  const [selectedEndDate, setSelectedEndDate] = useState(requestedEndDate);
  const [scheduleRangePreset, setScheduleRangePreset] = useState<
    (typeof scheduleRangePresets)[number]["key"]
  >("today");
  const [createClinicId, setCreateClinicId] = useState(initialCreateClinicId);
  const [clinicFilter, setClinicFilter] = useState(requestedClinicFilter);
  const [providerFilter, setProviderFilter] = useState(requestedProviderFilter);
  const [statusFilter, setStatusFilter] = useState(requestedStatusFilter);
  const [createAppointmentModalOpen, setCreateAppointmentModalOpen] = useState(false);
  const initialCreatePatient =
    formPatients.find((patient) => patient.id === requestedPatientId) ?? null;
  const [createPatientId, setCreatePatientId] = useState(initialCreatePatient?.id ?? "");
  const [createPatientSearch, setCreatePatientSearch] = useState("");
  const schedulePatientSearchQuery = normalizeSearchText(createPatientSearch.trim());
  const createFormProviders =
    formProviders?.filter((provider) => provider.clinicIds.includes(createClinicId)) ?? [];
  const createSelectedPatient =
    formPatients.find((patient) => patient.id === createPatientId) ?? null;
  const formReady = Boolean(
    canMutate &&
      formClinics?.length &&
      formPatients.length &&
      createSelectedPatient &&
      createFormProviders.length,
  );
  const createPatientSearchMatches = formPatients.filter((patient) =>
    patientMatchesExactSelectorSearch(patient, schedulePatientSearchQuery),
  );
  const filteredChairs =
    formChairs?.filter((chair) => clinicFilter === "all" || chair.clinicId === clinicFilter) ?? [];
  const filteredProviders =
    formProviders?.filter(
      (provider) => clinicFilter === "all" || provider.clinicIds.includes(clinicFilter),
    ) ?? [];
  const scheduleStartDate =
    selectedStartDate <= selectedEndDate ? selectedStartDate : selectedEndDate;
  const scheduleEndDate =
    selectedStartDate <= selectedEndDate ? selectedEndDate : selectedStartDate;
  const scheduleRangeLabel =
    scheduleStartDate === scheduleEndDate
      ? scheduleStartDate
      : `${scheduleStartDate} - ${scheduleEndDate}`;
  const applyScheduleRangePreset = (preset: (typeof scheduleRangePresets)[number]["key"]) => {
    setScheduleRangePreset(preset);

    if (preset === "custom") {
      return;
    }

    const range = schedulePresetRange(preset, today);
    setSelectedStartDate(range.start);
    setSelectedEndDate(range.end);
  };
  const dayAppointments = visibleAppointments
    .filter((appointment) => {
      const appointmentDate = appointment.startsAt
        ? vietnamDateInputFromIso(appointment.startsAt)
        : today;

      return (
        appointmentDate >= scheduleStartDate &&
        appointmentDate <= scheduleEndDate &&
        (clinicFilter === "all" || appointment.clinicId === clinicFilter) &&
        (providerFilter === "all" || appointment.providerId === providerFilter) &&
        (statusFilter === "all" || appointment.status === statusFilter)
      );
    })
    .sort((left, right) => {
      if (left.startsAt && right.startsAt) {
        return Date.parse(left.startsAt) - Date.parse(right.startsAt);
      }

      return left.time.localeCompare(right.time);
    });
  const activeDayAppointments = dayAppointments.filter(
    (appointment) => appointment.status !== "Cancelled" && appointment.status !== "No-show",
  );
  const arrivedAppointments = activeDayAppointments.filter(
    (appointment) => appointment.status === "Arrived",
  );
  const inChairAppointments = activeDayAppointments.filter(
    (appointment) => appointment.status === "In chair",
  );
  const occupiedChairAppointments = visibleAppointments.filter(
    (appointment) =>
      Boolean(appointment.chairId) &&
      appointment.status === "In chair" &&
      (clinicFilter === "all" || appointment.clinicId === clinicFilter),
  );
  const readyChairCount = filteredChairs.filter(
    (chair) =>
      chair.operationalStatus !== "BUSY" &&
      !occupiedChairAppointments.some((appointment) => appointment.chairId === chair.id),
  ).length;
  const readyProviderCount = filteredProviders.filter(
    (provider) => provider.operationalStatus !== "BUSY",
  ).length;
  const scheduleResourceClinics = activeVisibleClinics.filter(
    (clinic) =>
      clinicFilter === "all" ? visibleClinicIds.has(clinic.id) : clinic.id === clinicFilter,
  );
  const groupedChairs = scheduleResourceClinics
    .map((clinic) => {
      const chairs = filteredChairs.filter((chair) => chair.clinicId === clinic.id);
      const readyCount = chairs.filter(
        (chair) =>
          chair.operationalStatus !== "BUSY" &&
          !occupiedChairAppointments.some((appointment) => appointment.chairId === chair.id),
      ).length;

      return {
        clinic,
        chairs,
        readyCount,
      };
    })
    .filter((group) => group.chairs.length > 0 || clinicFilter !== "all");
  const groupedProviders = scheduleResourceClinics
    .map((clinic) => {
      const providers = filteredProviders.filter((provider) =>
        provider.clinicIds.includes(clinic.id),
      );
      const readyCount = providers.filter(
        (provider) => provider.operationalStatus !== "BUSY",
      ).length;

      return {
        clinic,
        providers,
        readyCount,
      };
    })
    .filter((group) => group.providers.length > 0 || clinicFilter !== "all");
  const bookingReadinessMessage =
    formReady
      ? null
      : !canMutate
        ? labels.bookingDisabled
        : !formClinics?.length
          ? labels.bookingDisabled
          : formPatients.length === 0
            ? labels.bookingDisabled
            : !createSelectedPatient
              ? labels.selectPatientRequired
              : createFormProviders.length === 0
                ? labels.bookingDisabled
                : labels.bookingDisabled;
  const scheduleFilterContext = {
    clinicId: clinicFilter,
    date: scheduleStartDate,
    dateTo: scheduleEndDate,
    providerFilter,
    statusFilter,
  };

  useEffect(() => {
    setSelectedStartDate(requestedStartDate);
    setSelectedEndDate(requestedEndDate);
    setClinicFilter(requestedClinicFilter);
    setProviderFilter(requestedProviderFilter);
    setStatusFilter(requestedStatusFilter);

    if (requestedClinicFilter !== "all") {
      setCreateClinicId(requestedClinicFilter);
    }

    setCreatePatientId((currentPatientId) => {
      if (currentPatientId && formPatients.some((patient) => patient.id === currentPatientId)) {
        return currentPatientId;
      }

      return formPatients.find((patient) => patient.id === requestedPatientId)?.id ?? "";
    });
  }, [
    formPatients,
    requestedClinicFilter,
    requestedEndDate,
    requestedPatientId,
    requestedProviderFilter,
    requestedStartDate,
    requestedStatusFilter,
  ]);

  return (
    <section className="view-stack">
      <div className="schedule-command-bar">
        <div>
          <h2>{labels.dispatchTitle}</h2>
        </div>
        <div className="schedule-metrics three">
          <MetricCard label={labels.booked} value={String(dayAppointments.length)} tone="blue" />
          <MetricCard label={labels.waiting} value={String(arrivedAppointments.length)} tone="amber" />
          <MetricCard label={labels.busy} value={String(inChairAppointments.length)} tone="teal" />
        </div>
        <SourceBadge source={scheduleWorkspace?.source} />
      </div>

      {(scheduleWorkspace?.message || notice) && (
        <div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(scheduleWorkspace?.message, language)}
        </div>
      )}

      <div className="service-action-row">
        <button
          className="primary-button"
          type="button"
          disabled={!canMutate}
          onClick={() => setCreateAppointmentModalOpen(true)}
        >
          <CalendarDays size={16} />
          {text.createBooking}
        </button>
      </div>

      {createAppointmentModalOpen && (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.createTitle}
          onClick={() => setCreateAppointmentModalOpen(false)}
        >
          <form
            action={createAppointmentAction}
            className="progress-modal schedule-create-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={() => setCreateAppointmentModalOpen(false)}
          >
            <div className="progress-modal-header">
              <div>
                <h3>{labels.createTitle}</h3>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={() => setCreateAppointmentModalOpen(false)}
                aria-label={language === "vi" ? "Đóng" : "Close"}
              >
                <X size={16} />
              </button>
            </div>
            <div className="booking-form modal-form-grid">
              <label>
                {text.clinic}
                <select
                  name="clinicId"
                  value={createClinicId}
                  onChange={(event) => setCreateClinicId(event.target.value)}
                  disabled={!canMutate || !formClinics?.length}
                  required
                >
                  {formClinics?.map((clinic) => (
                    <option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="booking-patient-search">
                <span>{text.patient}</span>
                <input name="patientId" type="hidden" value={createSelectedPatient?.id ?? ""} />
                <PatientSearchCombobox
                  disabled={!canMutate || formPatients.length === 0}
                  hideIcon
                  matches={createPatientSearchMatches}
                  noResultsLabel={labels.noMatchingPatients}
                  onQueryChange={(value) => {
                    setCreatePatientSearch(value);
                    setCreatePatientId("");
                  }}
                  onSelect={(patient) => {
                    setCreatePatientId(patient.id);
                    setCreatePatientSearch("");
                  }}
                  placeholder={labels.patientSearchPlaceholder}
                  query={createPatientSearch}
                  selectedPatient={createSelectedPatient}
                  selectLabel={text.patient}
                />
                {canMutate && !createSelectedPatient ? (
                  <small className="field-helper warning">{labels.selectPatientRequired}</small>
                ) : null}
              </div>
              <label>
                {text.provider}
                <select
                  name="providerId"
                  key={`provider-${createClinicId}`}
                  disabled={!canMutate || createFormProviders.length === 0}
                  required
                >
                  {createFormProviders.map((provider) => (
                    <option value={provider.id} key={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text.date}
                <input
                  name="date"
                  type="date"
                  value={selectedStartDate}
                  onChange={(event) => setSelectedStartDate(event.target.value)}
                  disabled={!canMutate}
                  required
                />
              </label>
              <label>
                {text.start}
                <input
                  name="startTime"
                  type="time"
                  defaultValue="09:00"
                  disabled={!canMutate}
                  required
                />
              </label>
              <label>
                {text.duration}
                <input
                  name="duration"
                  type="number"
                  min="15"
                  max="240"
                  step="15"
                  defaultValue="45"
                  disabled={!canMutate}
                  required
                />
              </label>
              <label className="booking-reason">
                {text.reason}
                <input
                  name="reason"
                  type="text"
                  placeholder={text.reasonPlaceholder}
                  disabled={!canMutate}
                  required
                />
              </label>
            </div>
            <div className="progress-modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCreateAppointmentModalOpen(false)}
              >
                {language === "vi" ? "Hủy" : "Cancel"}
              </button>
              {bookingReadinessMessage ? (
                <span className="booking-readiness" aria-live="polite">
                  {bookingReadinessMessage}
                </span>
              ) : null}
              <button className="primary-button" type="submit" disabled={!formReady}>
                <CalendarDays size={16} />
                {text.createBooking}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="schedule-filters panel">
        <label>
          {text.clinic}
          <select value={clinicFilter} onChange={(event) => setClinicFilter(event.target.value)}>
            <option value="all">{labels.allClinics}</option>
            {activeVisibleClinics.map((clinic) => (
              <option value={clinic.id} key={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.dateFrom}
          <input
            type="date"
            value={selectedStartDate}
            onChange={(event) => {
              setSelectedStartDate(event.target.value);
              setScheduleRangePreset("custom");
            }}
          />
        </label>
        <label>
          {labels.dateTo}
          <input
            type="date"
            value={selectedEndDate}
            onChange={(event) => {
              setSelectedEndDate(event.target.value);
              setScheduleRangePreset("custom");
            }}
          />
        </label>
        <div className="schedule-range-presets" aria-label={labels.quickRange}>
          {scheduleRangePresets.map((preset) => (
            <button
              className={scheduleRangePreset === preset.key ? "active" : ""}
              key={preset.key}
              type="button"
              onClick={() => applyScheduleRangePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label>
          {text.provider}
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="all">{labels.allProviders}</option>
            {filteredProviders.map((provider) => (
              <option value={provider.id} key={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.status}
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{labels.allStatuses}</option>
            {["Requested", "Confirmed", "Arrived", "In chair", "Completed", "No-show", "Cancelled"].map((status) => (
              <option value={status} key={status}>
                {displayStatus(status, language)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="schedule-ops-layout">
        <section className="panel schedule-table-panel">
          <PanelHeader icon={CalendarDays} title={labels.dispatchTitle} action={scheduleRangeLabel} />
          <div className="schedule-table">
            <div className="schedule-row schedule-row-head">
              <span>{text.time}</span>
              <span>{text.patient}</span>
              <span>{text.provider}</span>
              <span>{text.chair}</span>
              <span>{labels.status}</span>
              <span>{labels.actions}</span>
            </div>
            {dayAppointments.length > 0 ? (
              dayAppointments.map((appointment) => (
                <ScheduleAppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  chairs={filteredChairs}
                  canMutate={canMutate}
                  labels={labels}
                  language={language}
                  scheduleContext={scheduleFilterContext}
                  text={text}
                />
              ))
            ) : (
              <div className="schedule-empty-row">{text.available}</div>
            )}
          </div>
        </section>

        <aside className="schedule-side-stack">
          <details className="panel schedule-availability-details">
            <summary>
              <span>
                <Inbox size={16} />
                <strong>{labels.chairBoard}</strong>
              </span>
              <b>{readyChairCount}/{filteredChairs.length} {labels.chairSummary}</b>
            </summary>
            <div className="schedule-resource-groups schedule-availability-body">
              {groupedChairs.map((group) => (
                <section className="schedule-resource-group" key={group.clinic.id}>
                  <div className="schedule-resource-group-header">
                    <strong>{group.clinic.name}</strong>
                    <span>{group.readyCount}/{group.chairs.length} {labels.chairSummary}</span>
                  </div>
                  <div className="chair-status-grid">
                    {group.chairs.length > 0 ? (
                      group.chairs.map((chair) => {
                        const currentAppointment = occupiedChairAppointments.find(
                          (appointment) => appointment.chairId === chair.id,
                        );

                        return (
                          <ChairStatusCard
                            key={chair.id}
                            chair={chair}
                            appointment={currentAppointment}
                            canMutate={canMutate}
                            labels={labels}
                            scheduleContext={scheduleFilterContext}
                          />
                        );
                      })
                    ) : (
                      <EmptyState label={text.available} />
                    )}
                  </div>
                </section>
              ))}
            </div>
          </details>

          <details className="panel schedule-availability-details">
            <summary>
              <span>
                <Stethoscope size={16} />
                <strong>{labels.doctorBoard}</strong>
              </span>
              <b>{readyProviderCount}/{filteredProviders.length} {labels.providerSummary}</b>
            </summary>
            <div className="schedule-resource-groups schedule-availability-body">
              {groupedProviders.map((group) => (
                <section className="schedule-resource-group" key={group.clinic.id}>
                  <div className="schedule-resource-group-header">
                    <strong>{group.clinic.name}</strong>
                    <span>{group.readyCount}/{group.providers.length} {labels.providerSummary}</span>
                  </div>
                  <div className="provider-status-list">
                    {group.providers.length > 0 ? (
                      group.providers.map((provider) => {
                        const currentAppointment = inChairAppointments.find(
                          (appointment) => appointment.providerId === provider.id,
                        );
                        const providerIsBusy = provider.operationalStatus === "BUSY";

                        return (
                          <ProviderStatusCard
                            key={provider.id}
                            provider={provider}
                            appointment={currentAppointment}
                            busy={providerIsBusy}
                            canMutate={canMutate}
                            labels={labels}
                            scheduleContext={scheduleFilterContext}
                          />
                        );
                      })
                    ) : (
                      <EmptyState label={text.available} />
                    )}
                  </div>
                </section>
              ))}
            </div>
          </details>
        </aside>
      </section>
    </section>
  );
}

function ScheduleAppointmentRow({
  appointment,
  chairs,
  canMutate,
  labels,
  language,
  scheduleContext,
  text,
}: {
  appointment: Appointment;
  chairs: ScheduleWorkspace["chairs"];
  canMutate: boolean;
  labels: Record<string, string>;
  language: Language;
  scheduleContext: ScheduleFilterContext;
  text: (typeof scheduleText)[Language];
}) {
  const isLate =
    appointment.startsAt &&
    Date.parse(appointment.startsAt) < Date.now() &&
    !["Arrived", "In chair", "Completed", "Cancelled", "No-show"].includes(
      appointment.status,
    );
  const appointmentDate = appointment.startsAt
    ? vietnamDateInputFromIso(appointment.startsAt)
    : scheduleContext.date;
  const isPastAppointmentDay = appointmentDate < currentVietnamDateInput();
  const canChangeAppointment = canMutate && !isPastAppointmentDay;
  const pastLockedLabel =
    language === "vi" ? "Đã qua ngày hẹn" : "Past appointment";

  return (
    <div className={`schedule-row appointment-${appointment.status.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div>
        <strong>{appointment.time}</strong>
        <span>{appointment.duration}m</span>
        {isLate ? <small className="appointment-warning">{labels.late}</small> : null}
        {isPastAppointmentDay ? (
          <small className="appointment-locked">{pastLockedLabel}</small>
        ) : null}
      </div>
      <div>
        <strong>{appointment.patient}</strong>
        <span>{appointment.procedure}</span>
      </div>
      <div>
        <strong>{appointment.provider}</strong>
        <span>{text.provider}</span>
      </div>
      <div>
        <strong>{appointment.room}</strong>
        <span>{appointment.chairId ? labels.busy : labels.selectChair}</span>
      </div>
      <div>
        {canChangeAppointment ? (
          <AppointmentStatusSelect
            appointment={appointment}
            chairs={chairs}
            labels={labels}
            language={language}
            scheduleContext={scheduleContext}
          />
        ) : (
          <StatusPill status={appointment.status} />
        )}
      </div>
      <div className="appointment-actions schedule-row-actions">
        <div className="appointment-quick-links">
          <Link href={`/journey?patientId=${encodeURIComponent(appointment.patientId)}`}>
            {labels.openChart}
          </Link>
          <Link href={`/billing?patientId=${encodeURIComponent(appointment.patientId)}`}>
            {labels.openBilling}
          </Link>
        </div>
        {!canChangeAppointment && canMutate ? (
          <span className="appointment-action-note">{pastLockedLabel}</span>
        ) : null}
      </div>
    </div>
  );
}

const appointmentStatusOptions = [
  { value: "REQUESTED", status: "Requested" },
  { value: "CONFIRMED", status: "Confirmed" },
  { value: "ARRIVED", status: "Arrived" },
  { value: "IN_CHAIR", status: "In chair" },
  { value: "COMPLETED", status: "Completed" },
  { value: "NO_SHOW", status: "No-show" },
  { value: "CANCELLED", status: "Cancelled" },
] as const;

type AppointmentStatusValue = (typeof appointmentStatusOptions)[number]["value"];

function appointmentStatusValue(status: Appointment["status"]) {
  return appointmentStatusOptions.find((option) => option.status === status)?.value ?? "CONFIRMED";
}

function AppointmentStatusSelect({
  appointment,
  chairs,
  labels,
  language,
  scheduleContext,
}: {
  appointment: Appointment;
  chairs: ScheduleWorkspace["chairs"];
  labels: Record<string, string>;
  language: Language;
  scheduleContext: ScheduleFilterContext;
}) {
  const currentStatus = appointmentStatusValue(appointment.status);
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);
  const [chairModalOpen, setChairModalOpen] = useState(false);
  const statusFormRef = useRef<HTMLFormElement>(null);
  const cancelFormRef = useRef<HTMLFormElement>(null);
  const modalChairs = chairs.filter(
    (chair) =>
      chair.clinicId === appointment.clinicId &&
      (chair.operationalStatus !== "BUSY" || chair.id === appointment.chairId),
  );

  useEffect(() => {
    setSelectedStatus(currentStatus);
  }, [currentStatus]);

  function submitStatus(status: AppointmentStatusValue) {
    setSelectedStatus(status);
    window.setTimeout(() => statusFormRef.current?.requestSubmit(), 0);
  }

  function handleStatusChange(value: AppointmentStatusValue) {
    if (value === currentStatus) return;

    if (value === "IN_CHAIR") {
      setSelectedStatus(value);
      setChairModalOpen(true);
      return;
    }

    if (value === "NO_SHOW" && !window.confirm(labels.confirmNoShow)) {
      setSelectedStatus(currentStatus);
      return;
    }

    if (value === "CANCELLED") {
      if (!window.confirm(labels.confirmCancel)) {
        setSelectedStatus(currentStatus);
        return;
      }
      setSelectedStatus(value);
      window.setTimeout(() => cancelFormRef.current?.requestSubmit(), 0);
      return;
    }

    submitStatus(value);
  }

  return (
    <div className="appointment-status-control">
      <form ref={statusFormRef} action={updateAppointmentStatusAction} hidden>
        <input name="appointmentId" type="hidden" value={appointment.id} />
        <input name="patientId" type="hidden" value={appointment.patientId} />
        <input name="status" type="hidden" value={selectedStatus} />
        <ScheduleFilterHiddenFields context={scheduleContext} />
      </form>
      <form ref={cancelFormRef} action={cancelAppointmentAction} hidden>
        <input name="appointmentId" type="hidden" value={appointment.id} />
        <input name="patientId" type="hidden" value={appointment.patientId} />
        <ScheduleFilterHiddenFields context={scheduleContext} />
      </form>
      <select
        aria-label={labels.status}
        value={selectedStatus}
        onChange={(event) => handleStatusChange(event.target.value as AppointmentStatusValue)}
      >
        {appointmentStatusOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {displayStatus(option.status, language)}
          </option>
        ))}
      </select>
      {chairModalOpen ? (
        <div
          className="progress-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={labels.selectChair}
          onClick={() => {
            setChairModalOpen(false);
            setSelectedStatus(currentStatus);
          }}
        >
          <form
            action={updateAppointmentStatusAction}
            className="progress-modal appointment-chair-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="progress-modal-header">
              <div>
                <span>{appointment.patient}</span>
                <h3>{labels.selectChair}</h3>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={() => {
                  setChairModalOpen(false);
                  setSelectedStatus(currentStatus);
                }}
                aria-label={language === "vi" ? "Đóng" : "Close"}
              >
                <X size={16} />
              </button>
            </div>
            <input name="appointmentId" type="hidden" value={appointment.id} />
            <input name="patientId" type="hidden" value={appointment.patientId} />
            <input name="status" type="hidden" value="IN_CHAIR" />
            <ScheduleFilterHiddenFields context={scheduleContext} />
            <div className="appointment-chair-grid">
              {modalChairs.length > 0 ? (
                modalChairs.map((chair) => (
                  <button className="secondary-button" name="chairId" type="submit" value={chair.id} key={chair.id}>
                    {chair.name}
                  </button>
                ))
              ) : (
                <span className="appointment-action-note">{labels.selectChair}</span>
              )}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function vietnamDateInputFromIso(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function currentVietnamDateInput() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function schedulePresetRange(
  preset: "today" | "this-week" | "last-week" | "this-month" | "last-month",
  today: string,
) {
  const current = dateInputToUtcDate(today);
  const day = current.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const thisWeekStart = addUtcDays(current, mondayOffset);
  const thisWeekEnd = addUtcDays(thisWeekStart, 6);
  const thisMonthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const thisMonthEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));

  if (preset === "today") {
    return { start: today, end: today };
  }

  if (preset === "this-week") {
    return {
      start: utcDateToDateInput(thisWeekStart),
      end: utcDateToDateInput(thisWeekEnd),
    };
  }

  if (preset === "last-week") {
    return {
      start: utcDateToDateInput(addUtcDays(thisWeekStart, -7)),
      end: utcDateToDateInput(addUtcDays(thisWeekEnd, -7)),
    };
  }

  if (preset === "this-month") {
    return {
      start: utcDateToDateInput(thisMonthStart),
      end: utcDateToDateInput(thisMonthEnd),
    };
  }

  return {
    start: utcDateToDateInput(
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)),
    ),
    end: utcDateToDateInput(
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0)),
    ),
  };
}

function dateInputToUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function utcDateToDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

type ScheduleFilterContext = {
  clinicId: string;
  date: string;
  dateTo: string;
  providerFilter: string;
  statusFilter: string;
};

function ScheduleFilterHiddenFields({ context }: { context: ScheduleFilterContext }) {
  return (
    <>
      <input name="clinicId" type="hidden" value={context.clinicId} />
      <input name="date" type="hidden" value={context.date} />
      <input name="dateTo" type="hidden" value={context.dateTo} />
      <input name="providerFilter" type="hidden" value={context.providerFilter} />
      <input name="statusFilter" type="hidden" value={context.statusFilter} />
    </>
  );
}

function ChairStatusCard({
  chair,
  appointment,
  canMutate,
  labels,
  scheduleContext,
}: {
  chair: ScheduleWorkspace["chairs"][number];
  appointment?: Appointment;
  canMutate: boolean;
  labels: Record<string, string>;
  scheduleContext: ScheduleFilterContext;
}) {
  const isBusy = Boolean(appointment) || chair.operationalStatus === "BUSY";

  return (
    <article className={`chair-status-card ${isBusy ? "busy" : "ready"}`}>
      <div>
        <strong>{chair.name}</strong>
        <span>{isBusy ? labels.busy : labels.ready}</span>
      </div>
      {appointment ? (
        <small>{appointment.patient} · {appointment.provider}</small>
      ) : null}
      {canMutate ? (
        <div className="status-toggle-actions">
          <ChairOperationalStatusForm
            appointment={appointment}
            chair={chair}
            label={labels.busyAction}
            patientId={appointment?.patientId}
            scheduleContext={scheduleContext}
            status="BUSY"
          />
          <ChairOperationalStatusForm
            appointment={appointment}
            chair={chair}
            label={appointment ? labels.chairReady : labels.readyAction}
            patientId={appointment?.patientId}
            scheduleContext={scheduleContext}
            status="READY"
          />
        </div>
      ) : null}
    </article>
  );
}

function ChairOperationalStatusForm({
  appointment,
  chair,
  label,
  patientId,
  scheduleContext,
  status,
}: {
  appointment?: Appointment;
  chair: ScheduleWorkspace["chairs"][number];
  label: string;
  patientId?: string;
  scheduleContext: ScheduleFilterContext;
  status: "READY" | "BUSY";
}) {
  return (
    <form action={updateChairOperationalStatusAction}>
      <input name="chairId" type="hidden" value={chair.id} />
      <input name="appointmentId" type="hidden" value={appointment?.id ?? ""} />
      <input name="patientId" type="hidden" value={patientId ?? ""} />
      <input name="operationalStatus" type="hidden" value={status} />
      <ScheduleFilterHiddenFields context={scheduleContext} />
      <button type="submit">{label}</button>
    </form>
  );
}

function ProviderStatusCard({
  provider,
  appointment,
  busy,
  canMutate,
  labels,
  scheduleContext,
}: {
  provider: ScheduleWorkspace["providers"][number];
  appointment?: Appointment;
  busy: boolean;
  canMutate: boolean;
  labels: Record<string, string>;
  scheduleContext: ScheduleFilterContext;
}) {
  return (
    <article className={`provider-status-card ${busy ? "busy" : "ready"}`}>
      <div>
        <strong>{provider.name}</strong>
        <span>{busy ? labels.busy : labels.ready}</span>
      </div>
      <small>{appointment ? appointment.patient : provider.role}</small>
      {canMutate ? (
        <div className="status-toggle-actions">
          <ProviderOperationalStatusForm
            label={labels.busyAction}
            patientId={appointment?.patientId}
            provider={provider}
            scheduleContext={scheduleContext}
            status="BUSY"
          />
          <ProviderOperationalStatusForm
            label={labels.readyAction}
            patientId={appointment?.patientId}
            provider={provider}
            scheduleContext={scheduleContext}
            status="READY"
          />
        </div>
      ) : null}
    </article>
  );
}

function ProviderOperationalStatusForm({
  label,
  patientId,
  provider,
  scheduleContext,
  status,
}: {
  label: string;
  patientId?: string;
  provider: ScheduleWorkspace["providers"][number];
  scheduleContext: ScheduleFilterContext;
  status: "READY" | "BUSY";
}) {
  return (
    <form action={updateProviderOperationalStatusAction}>
      <input name="providerId" type="hidden" value={provider.id} />
      <input name="patientId" type="hidden" value={patientId ?? ""} />
      <input name="operationalStatus" type="hidden" value={status} />
      <ScheduleFilterHiddenFields context={scheduleContext} />
      <button type="submit">{label}</button>
    </form>
  );
}


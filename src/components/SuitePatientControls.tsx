"use client";
import { normalizeSearchText } from "@/shared/search";
import { stableNumberFromText, patientCodeFor, patientClassCodeFor, patientGenderLabel, patientLeadSourceOptions } from "@/lib/patient-presentation";
import { CalendarCheck, Search, Stethoscope, Wallet, X, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Language } from "@/components/AppLanguage";
import { type Appointment, type Patient } from "@/lib/data";
import type { BillingWorkspace } from "@/lib/billing-types";
import { matchesChartSearch } from "@/shared/search";
export type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> & Partial<Pick<Patient, "address" | "age" | "city" | "clinicId" | "consent" | "email" | "flags" | "gender" | "guardianName" | "lastVisit" | "leadSource" | "nationalId" | "patientCode" | "treatmentProgress" | "visitReason">>;
export function PatientSearchCombobox({ disabled = false, hideIcon = false, query, onQueryChange, matches, selectedPatient, showSelectedPatientLabel = true, placeholder, selectLabel, noResultsLabel, onSelect, }: {
    disabled?: boolean;
    hideIcon?: boolean;
    query: string;
    onQueryChange: (value: string) => void;
    matches: PatientSearchRecord[];
    selectedPatient?: PatientSearchRecord | null;
    showSelectedPatientLabel?: boolean;
    placeholder: string;
    selectLabel: string;
    noResultsLabel: string;
    onSelect: (patient: PatientSearchRecord) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const normalizedQuery = normalizeSearchText(query.trim());
    const selectedPatientLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
    const inputValue = query || (showSelectedPatientLabel ? selectedPatientLabel : "");
    const visibleMatches = normalizedQuery
        ? matches.filter((patient) => patient.id !== selectedPatient?.id).slice(0, 8)
        : [];
    const shouldShowResults = isOpen && normalizedQuery.length > 0;
    return (<div className="patient-search-combobox">
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true"/>}
        <input ref={inputRef} aria-autocomplete="list" aria-expanded={shouldShowResults} aria-label={selectLabel} disabled={disabled} onBlur={() => setIsOpen(false)} onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
        }} onFocus={() => {
            setIsOpen(true);
            if (!query && selectedPatientLabel) {
                requestAnimationFrame(() => inputRef.current?.select());
            }
        }} placeholder={placeholder} value={inputValue}/>
      </label>
      {shouldShowResults ? (<div className="patient-search-results" role="listbox" aria-label={selectLabel}>
          {visibleMatches.length > 0 ? (visibleMatches.map((patient) => (<button className="patient-search-option" key={patient.id} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                    onSelect(patient);
                    setIsOpen(false);
                }} role="option" type="button">
                <strong>{patient.name}</strong>
                <span>
                  {patientCodeFor(patient)} - {patient.phone}
                  {patient.email ? ` - ${patient.email}` : ""}
                </span>
              </button>))) : (<div className="patient-search-empty">{noResultsLabel}</div>)}
        </div>) : null}
    </div>);
}
export function JourneyPatientMenu({ appointments, billingWorkspace, clinics, language, onClose, onOpenBilling, onOpenProfile, onSelect, open, patients, selectedPatientId, }: {
    appointments: Appointment[];
    billingWorkspace?: BillingWorkspace | null;
    clinics: Array<{
        id: string;
        name: string;
    }>;
    language: Language;
    onClose: () => void;
    onOpenBilling: (patientId: string) => void;
    onOpenProfile: (patientId: string) => void;
    onSelect: (patient: PatientSearchRecord) => void;
    open: boolean;
    patients: PatientSearchRecord[];
    selectedPatientId: string;
}) {
    const [query, setQuery] = useState("");
    const normalizedQuery = normalizeSearchText(query.trim());
    const matchedPatients = normalizedQuery
        ? patientSearchMatches(patients, normalizedQuery)
        : patients;
    const matchedIds = new Set(matchedPatients.map((patient) => patient.id));
    const clinicById = new Map(clinics.map((clinic) => [clinic.id, clinic.name]));
    const todayAppointmentPatientIds = new Set(appointments
        .filter((appointment) => isJourneyTodayAppointment(appointment))
        .filter((appointment) => appointment.status !== "Cancelled" && appointment.status !== "No-show")
        .map((appointment) => appointment.patientId));
    const treatmentPatientIds = new Set(billingWorkspace?.treatmentServices
        .filter((service) => service.status !== "COMPLETED" &&
        service.status !== "CANCELLED" &&
        service.currentProgressPercent > 0)
        .map((service) => service.patientId) ?? []);
    const collectionPatientIds = new Set(billingWorkspace?.treatmentServices
        .filter((service) => {
        const applied = Math.min(service.finalPrice, service.collectedAmount + service.creditAllocatedAmount);
        return service.currentProgressPercent > 0 && service.finalPrice - applied > 0;
    })
        .map((service) => service.patientId) ?? []);
    const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
    const recentPatients = [...patients]
        .sort((left, right) => patientVisitSortValue(right) - patientVisitSortValue(left))
        .slice(0, 12);
    const groups = [
        {
            key: "today",
            icon: <CalendarCheck size={15} aria-hidden="true"/>,
            title: language === "vi" ? "Lịch hôm nay" : "Today",
            patients: patients.filter((patient) => todayAppointmentPatientIds.has(patient.id)),
        },
        {
            key: "treatment",
            icon: <Stethoscope size={15} aria-hidden="true"/>,
            title: language === "vi" ? "Đang điều trị" : "In treatment",
            patients: patients.filter((patient) => treatmentPatientIds.has(patient.id) ||
                ((patient.treatmentProgress ?? 0) > 0 && (patient.treatmentProgress ?? 0) < 100)),
        },
        {
            key: "collection",
            icon: <Wallet size={15} aria-hidden="true"/>,
            title: language === "vi" ? "Còn phải thu" : "Collection due",
            patients: patients.filter((patient) => collectionPatientIds.has(patient.id)),
        },
        {
            key: "recent",
            icon: <UsersRound size={15} aria-hidden="true"/>,
            title: language === "vi" ? "Gần đây" : "Recent",
            patients: recentPatients,
        },
    ];
    useEffect(() => {
        if (!open) {
            return;
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose, open]);
    if (!open) {
        return null;
    }
    return (<div className="journey-patient-menu-backdrop" role="presentation" onMouseDown={onClose}>
      <aside aria-label={language === "vi" ? "Menu bệnh nhân" : "Patient menu"} aria-modal="true" className="journey-patient-menu" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header className="journey-patient-menu-header">
          <div>
            <span>{language === "vi" ? "Hành trình điều trị" : "Treatment journey"}</span>
            <h3>{language === "vi" ? "Menu bệnh nhân" : "Patient menu"}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={language === "vi" ? "Đóng" : "Close"}>
            <X size={17} aria-hidden="true"/>
          </button>
        </header>

        <label className="search-field journey-patient-menu-search">
          <Search size={16} aria-hidden="true"/>
          <input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={language === "vi" ? "Tìm tên, mã, số điện thoại" : "Search name, code, phone"} value={query}/>
        </label>

        {selectedPatient ? (<div className="journey-patient-current">
            <span>{language === "vi" ? "Đang mở" : "Current chart"}</span>
            <strong>{selectedPatient.name}</strong>
            <small>{patientSearchDisplayLabel(selectedPatient)}</small>
            <div>
              <button type="button" className="secondary-button" onClick={() => onOpenProfile(selectedPatient.id)}>
                {language === "vi" ? "Hồ sơ" : "Profile"}
              </button>
              <button type="button" className="secondary-button" onClick={() => onOpenBilling(selectedPatient.id)}>
                {language === "vi" ? "Thu tiền" : "Billing"}
              </button>
            </div>
          </div>) : null}

        <div className="journey-patient-menu-list">
          {groups.map((group) => {
            const groupPatients = group.patients
                .filter((patient) => matchedIds.has(patient.id))
                .slice(0, 8);
            if (groupPatients.length === 0) {
                return null;
            }
            return (<section className="journey-patient-menu-group" key={group.key}>
                <h4>
                  {group.icon}
                  {group.title}
                </h4>
                {groupPatients.map((patient) => (<button className={patient.id === selectedPatientId
                        ? "journey-patient-menu-card active"
                        : "journey-patient-menu-card"} key={`${group.key}-${patient.id}`} onClick={() => onSelect(patient)} type="button">
                    <strong>{patient.name}</strong>
                    <span>
                      {patientCodeFor(patient)} · {patient.phone}
                    </span>
                    <small>
                      {clinicById.get(patient.clinicId ?? "") ?? patient.city ?? ""}
                      {patient.visitReason ? ` · ${patient.visitReason}` : ""}
                    </small>
                  </button>))}
              </section>);
        })}

          {matchedPatients.length === 0 ? (<div className="journey-patient-menu-empty">
              {language === "vi" ? "Không tìm thấy bệnh nhân phù hợp." : "No matching patients."}
            </div>) : null}
        </div>
      </aside>
    </div>);
}
export function patientSearchDisplayLabel(patient: PatientSearchRecord) {
    return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`;
}
export function patientLeadSourceLabel(source: string | null | undefined, language: Language) {
    const normalizedSource = String(source ?? "WALK_IN").toUpperCase();
    return (patientLeadSourceOptions(language).find((option) => option.value === normalizedSource)
        ?.label ?? normalizedSource);
}
export function isJourneyTodayAppointment(appointment: Appointment) {
    if (!appointment.startsAt) {
        return true;
    }
    const startsAt = new Date(appointment.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
        return false;
    }
    const today = new Date();
    return (startsAt.getFullYear() === today.getFullYear() &&
        startsAt.getMonth() === today.getMonth() &&
        startsAt.getDate() === today.getDate());
}
export function patientVisitSortValue(patient: PatientSearchRecord) {
    const dateValue = Date.parse(String(patient.lastVisit ?? ""));
    if (!Number.isNaN(dateValue)) {
        return dateValue;
    }
    return stableNumberFromText(patient.id, 100000);
}
export function patientMatchesExactSelectorSearch(patient: PatientSearchRecord, query: string) {
    return matchesChartSearch(query, [
        patient.name,
        patient.phone,
        patientCodeFor(patient),
        typeof patient.age === "number" && patient.flags ? patientClassCodeFor(patient as Patient) : null,
        patient.email,
        patientGenderLabel(patient.gender, "vi"),
        patientGenderLabel(patient.gender, "en"),
        patientLeadSourceLabel(patient.leadSource, "vi"),
        patientLeadSourceLabel(patient.leadSource, "en"),
        patient.visitReason,
        patient.nationalId,
        patient.address,
        patient.city,
        patient.guardianName,
        patient.consent,
        ...(patient.flags ?? []),
    ]);
}
export function patientSearchMatches(patients: PatientSearchRecord[], query: string) {
    if (!query) {
        return patients;
    }
    return patients
        .map((patient, index) => ({
        patient,
        index,
        rank: patientSearchRank(patient, query),
    }))
        .filter((item) => item.rank < Number.POSITIVE_INFINITY)
        .sort((left, right) => left.rank - right.rank || left.index - right.index)
        .map((item) => item.patient);
}
export function patientSearchRank(patient: PatientSearchRecord, query: string) {
    const name = normalizeSearchText(patient.name);
    const phone = normalizeSearchText(patient.phone);
    const code = normalizeSearchText(patientCodeFor(patient));
    const nameTokens = name.split(/\s+/).filter(Boolean);
    if (code.startsWith(query) || phone.startsWith(query)) {
        return 0;
    }
    if (nameTokens.some((token) => token.startsWith(query))) {
        return 1;
    }
    if (name.includes(query)) {
        return 2;
    }
    if (code.includes(query) || phone.includes(query)) {
        return 3;
    }
    return patientMatchesExactSelectorSearch(patient, query)
        ? 4
        : Number.POSITIVE_INFINITY;
}

"use client";

import { CalendarCheck, Search, Stethoscope, UsersRound, Wallet, X } from "lucide-react";
import { useState } from "react";
import type { Appointment } from "@/lib/data";
import type { BillingWorkspace } from "@/lib/billing-types";
import type { StoryLanguage as Language } from "@/workspaces/workspace-story";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { isJourneyTodayAppointment, normalizeSearchText, patientCodeFor, patientSearchDisplayLabel, patientSearchMatches, patientVisitSortValue, type PatientSearchRecord } from "./patient-search";

export function JourneyPatientMenu({
  appointments,
  billingWorkspace,
  clinics,
  language,
  onClose,
  onOpenBilling,
  onOpenProfile,
  onSelect,
  open,
  patients,
  selectedPatientId,
}: {
  appointments: Appointment[];
  billingWorkspace?: BillingWorkspace | null;
  clinics: Array<{ id: string; name: string }>;
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
  const todayAppointmentPatientIds = new Set(
    appointments
      .filter((appointment) => isJourneyTodayAppointment(appointment))
      .filter((appointment) => appointment.status !== "Cancelled" && appointment.status !== "No-show")
      .map((appointment) => appointment.patientId),
  );
  const treatmentPatientIds = new Set(
    billingWorkspace?.treatmentServices
      .filter(
        (service) =>
          service.status !== "COMPLETED" &&
          service.status !== "CANCELLED" &&
          service.currentProgressPercent > 0,
      )
      .map((service) => service.patientId) ?? [],
  );
  const collectionPatientIds = new Set(
    billingWorkspace?.treatmentServices
      .filter((service) => {
        const applied = Math.min(
          service.finalPrice,
          service.collectedAmount + service.creditAllocatedAmount,
        );

        return service.currentProgressPercent > 0 && service.finalPrice - applied > 0;
      })
      .map((service) => service.patientId) ?? [],
  );
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const recentPatients = [...patients]
    .sort((left, right) => patientVisitSortValue(right) - patientVisitSortValue(left))
    .slice(0, 12);
  const groups = [
    {
      key: "today",
      icon: <CalendarCheck size={15} aria-hidden="true" />,
      title: language === "vi" ? "Lịch hôm nay" : "Today",
      patients: patients.filter((patient) => todayAppointmentPatientIds.has(patient.id)),
    },
    {
      key: "treatment",
      icon: <Stethoscope size={15} aria-hidden="true" />,
      title: language === "vi" ? "Đang điều trị" : "In treatment",
      patients: patients.filter(
        (patient) =>
          treatmentPatientIds.has(patient.id) ||
          ((patient.treatmentProgress ?? 0) > 0 && (patient.treatmentProgress ?? 0) < 100),
      ),
    },
    {
      key: "collection",
      icon: <Wallet size={15} aria-hidden="true" />,
      title: language === "vi" ? "Còn phải thu" : "Collection due",
      patients: patients.filter((patient) => collectionPatientIds.has(patient.id)),
    },
    {
      key: "recent",
      icon: <UsersRound size={15} aria-hidden="true" />,
      title: language === "vi" ? "Gần đây" : "Recent",
      patients: recentPatients,
    },
  ];

  if (!open) return null;

  return (
    <WorkspaceDialog open onClose={onClose}
      title={language === "vi" ? "Menu b\u1ec7nh nh\u00e2n" : "Patient menu"}
      closeLabel={language === "vi" ? "\u0110\u00f3ng" : "Close"}
      hideHeader className="patient-lookup-dialog">
      <div className="journey-patient-menu">
        <header className="journey-patient-menu-header">
          <div>
            <span>{language === "vi" ? "Hành trình điều trị" : "Treatment journey"}</span>
            <h3>{language === "vi" ? "Menu bệnh nhân" : "Patient menu"}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={language === "vi" ? "Đóng" : "Close"}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <label className="search-field journey-patient-menu-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={language === "vi" ? "T\u00ecm trong menu b\u1ec7nh nh\u00e2n" : "Search patient menu"}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={language === "vi" ? "Tìm tên, mã, số điện thoại" : "Search name, code, phone"}
            value={query}
          />
        </label>

        {selectedPatient ? (
          <div className="journey-patient-current">
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
          </div>
        ) : null}

        <div className="journey-patient-menu-list">
          {groups.map((group) => {
            const groupPatients = group.patients
              .filter((patient) => matchedIds.has(patient.id))
              .slice(0, 8);

            if (groupPatients.length === 0) {
              return null;
            }

            return (
              <section className="journey-patient-menu-group" key={group.key}>
                <h4>
                  {group.icon}
                  {group.title}
                </h4>
                {groupPatients.map((patient) => (
                  <button
                    className={
                      patient.id === selectedPatientId
                        ? "journey-patient-menu-card active"
                        : "journey-patient-menu-card"
                    }
                    key={`${group.key}-${patient.id}`}
                    onClick={() => onSelect(patient)}
                    type="button"
                  >
                    <strong>{patient.name}</strong>
                    <span>
                      {patientCodeFor(patient)} · {patient.phone}
                    </span>
                    <small>
                      {clinicById.get(patient.clinicId ?? "") ?? patient.city ?? ""}
                      {patient.visitReason ? ` · ${patient.visitReason}` : ""}
                    </small>
                  </button>
                ))}
              </section>
            );
          })}

          {matchedPatients.length === 0 ? (
            <div className="journey-patient-menu-empty">
              {language === "vi" ? "Không tìm thấy bệnh nhân phù hợp." : "No matching patients."}
            </div>
          ) : null}
        </div>
      </div>
    </WorkspaceDialog>
  );
}


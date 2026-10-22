"use client";
import { useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Patient } from "@/lib/data";
import { normalizeSearchText } from "@/shared/search";
import { patientCodeFor } from "@/lib/patient-presentation";
type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> &
  Partial<Pick<Patient, "email" | "patientCode">>;
function patientSearchDisplayLabel(patient: PatientSearchRecord) { return `${patientCodeFor(patient)} - ${patient.name} - ${patient.phone}`; }
export function PatientSearchCombobox({
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

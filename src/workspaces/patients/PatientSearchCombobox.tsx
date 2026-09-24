"use client";

import { Search } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { normalizeSearchText, patientCodeFor, patientSearchDisplayLabel, type PatientSearchRecord } from "./patient-search";
import { patientLookupCommand } from "./patient-search-keyboard";

export function PatientSearchCombobox({
  disabled = false, hideIcon = false, query, onQueryChange, matches,
  selectedPatient, showSelectedPatientLabel = true, placeholder, selectLabel,
  noResultsLabel, onSelect,
}: {
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
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedLabel = selectedPatient ? patientSearchDisplayLabel(selectedPatient) : "";
  const normalizedQuery = normalizeSearchText(query.trim());
  const visibleMatches = normalizedQuery
    ? matches.filter(patient => patient.id !== selectedPatient?.id).slice(0, 8)
    : [];
  const expanded = !disabled && isOpen && normalizedQuery.length > 0;
  const activeIndex = expanded ? visibleMatches.findIndex(patient => patient.id === activeId) : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function close() {
    setIsOpen(false);
    setActiveId(null);
  }
  function choose(patient: PatientSearchRecord) {
    onSelect(patient);
    inputRef.current?.focus();
    close();
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const command = patientLookupCommand(event.nativeEvent);
    if (command === "dismiss" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (command === "leave") { close(); return; }
    if (command === "select" && activeIndex >= 0) {
      event.preventDefault();
      choose(visibleMatches[activeIndex]);
      return;
    }
    if ((command !== "next" && command !== "previous") || !visibleMatches.length) return;
    event.preventDefault();
    const index = command === "next"
      ? (activeIndex + 1) % visibleMatches.length
      : activeIndex <= 0 ? visibleMatches.length - 1 : activeIndex - 1;
    setIsOpen(true);
    setActiveId(visibleMatches[index].id);
    // aria-activedescendant keeps DOM focus in the input, so scroll the option ourselves.
    requestAnimationFrame(() => listRef.current?.children[index]?.scrollIntoView({ block: "nearest" }));
  }

  return (
    <div className="patient-search-combobox" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <label className="search-field topbar-search-field patient-search-input">
        {!hideIcon && <Search size={16} aria-hidden="true" />}
        <input ref={inputRef} role="combobox" aria-autocomplete="list"
          aria-controls={listId} aria-expanded={expanded}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-label={selectLabel} autoComplete="off" disabled={disabled}
          onKeyDown={handleKeyDown}
          onChange={event => { onQueryChange(event.target.value); setActiveId(null); setIsOpen(true); }}
          onFocus={() => {
            setIsOpen(true);
            if (!query && selectedLabel) requestAnimationFrame(() => inputRef.current?.select());
          }}
          placeholder={placeholder} value={query || (showSelectedPatientLabel ? selectedLabel : "")}
        />
      </label>
      <div ref={listRef} id={listId} className="patient-search-results" role="listbox" aria-label={selectLabel} hidden={!expanded}>
        {expanded && (visibleMatches.length > 0 ? visibleMatches.map((patient, index) => (
          <button className="patient-search-option" key={patient.id} id={optionId(index)}
            role="option" aria-selected={activeIndex === index} tabIndex={-1} type="button"
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose(patient)}>
            <strong>{patient.name}</strong>
            <span>{patientCodeFor(patient)} - {patient.phone}{patient.email ? ` - ${patient.email}` : ""}</span>
          </button>
        )) : <div className="patient-search-empty" role="status">{noResultsLabel}</div>)}
      </div>
    </div>
  );
}

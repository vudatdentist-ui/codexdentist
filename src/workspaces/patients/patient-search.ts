import type { Patient, Appointment } from "@/lib/data";
import type { Language } from "@/components/AppLanguage";
import { normalizeSearchText, matchesChartSearch } from "@/shared/search";
import { stableNumberFromText, patientCodeFor, patientClassCodeFor, patientGenderLabel, patientLeadSourceOptions } from "@/lib/patient-presentation";
export { normalizeSearchText, matchesChartSearch } from "@/shared/search";
export { patientCodeFor } from "@/lib/patient-presentation";
export type PatientSearchRecord = Pick<Patient, "id" | "name" | "phone"> & Partial<Pick<Patient, "address" | "age" | "city" | "clinicId" | "consent" | "email" | "flags" | "gender" | "guardianName" | "lastVisit" | "leadSource" | "nationalId" | "patientCode" | "treatmentProgress" | "visitReason">>;
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

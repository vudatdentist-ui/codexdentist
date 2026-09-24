export type PatientSelectionState = "ready" | "unselected" | "empty" | "unavailable" | "invalid" | "loading";

export type PatientSelectionInput = {
  available: boolean;
  patientIds: readonly string[];
  selectedPatientId: string;
  requestedPatientId?: string | null;
};

// Only the authorized, scoped collection can establish whether a record is selectable.
export function resolvePatientSelection({ available, patientIds, selectedPatientId, requestedPatientId }: PatientSelectionInput): PatientSelectionState {
  if (!available) return "unavailable";
  if (requestedPatientId && !patientIds.includes(requestedPatientId)) return "invalid";
  if (patientIds.length === 0) return "empty";
  if (requestedPatientId && requestedPatientId !== selectedPatientId) return "loading";
  if (selectedPatientId) return patientIds.includes(selectedPatientId) ? "ready" : "invalid";
  return "unselected";
}

export type PatientSelectionState = "ready" | "unselected" | "empty" | "unavailable" | "invalid" | "loading";

export function resolvePatientSelection({ available, patientIds, selectedPatientId, requestedPatientId }: {
  available: boolean;
  patientIds: readonly string[];
  selectedPatientId: string;
  requestedPatientId?: string | null;
}): PatientSelectionState {
  if (!available) return "unavailable";
  if (requestedPatientId && !patientIds.includes(requestedPatientId)) return "invalid";
  if (!patientIds.length) return "empty";
  if (!requestedPatientId) return "unselected";
  if (requestedPatientId !== selectedPatientId) return "loading";
  return "ready";
}

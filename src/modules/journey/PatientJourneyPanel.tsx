"use client";
import { PatientSelectionBoundary } from "@/workspaces/patients/PatientSelectionBoundary";
import { usePatientJourneyPanelModel } from "./journey-model";
import { PatientJourneyPanelView } from "./journey-view";
type Props = Parameters<typeof usePatientJourneyPanelModel>[0];
function PatientJourneyRecord(props: Props) {
  const model = usePatientJourneyPanelModel(props);
  return <PatientJourneyPanelView {...model} />;
}
export function PatientJourneyPanel(props: Props) {
  return <PatientSelectionBoundary available={props.patientWorkspace?.source === "database"}
    patientIds={props.visiblePatients.map(patient => patient.id)} selectedPatientId={props.selectedPatientId}>
    <PatientJourneyRecord {...props} />
  </PatientSelectionBoundary>;
}

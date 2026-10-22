"use client";

import { usePatientJourneyPanelModel } from "./journey-model";
import { PatientJourneyPanelView } from "./journey-view";

export function PatientJourneyPanel(props: Parameters<typeof usePatientJourneyPanelModel>[0]) {
  const model = usePatientJourneyPanelModel(props);
  return <PatientJourneyPanelView {...model} />;
}

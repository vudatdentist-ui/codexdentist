"use client";

import { Activity, type ComponentProps } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppLanguage } from "@/components/AppLanguage";
import { PatientSelectionNotice } from "@/workspaces/patients/PatientSelectionNotice";
import { resolvePatientSelection } from "@/workspaces/patients/patient-selection-state";
import { PatientJourneyPanel as PatientJourneyRecord } from "./PatientJourneyRecord";

type PatientJourneyProps = ComponentProps<typeof PatientJourneyRecord>;

export function PatientJourneyPanel(props: PatientJourneyProps) {
  const { language } = useAppLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = resolvePatientSelection({
    available: props.patientWorkspace?.source === "database",
    patientIds: props.visiblePatients.map(patient => patient.id),
    selectedPatientId: props.selectedPatientId,
    requestedPatientId: searchParams.get("patientId"),
  });

  return <>
    {state !== "ready" && <PatientSelectionNotice state={state} language={language} onRetry={() => router.refresh()} />}
    {/* Hiding a transiently mismatched URL must not throw away an unsent chart draft. */}
    <Activity mode={state === "ready" ? "visible" : "hidden"}>
      <PatientJourneyRecord {...props} />
    </Activity>
  </>;
}

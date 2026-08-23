import "server-only";

import { canPerformAction } from "@/lib/actions/permissions";
import { getClinicalWorkspace } from "@/lib/clinical";
import type { ClinicalNoteSummary } from "@/lib/clinical-types";
import type { Patient } from "@/lib/data";
import { getPatientWorkspace } from "@/lib/patients";
import { canAccessView } from "@/lib/permissions";
import { getServicesWorkspace } from "@/lib/services";
import type {
  ServicesWorkspace,
  TreatmentServiceSummary,
} from "@/lib/services-types";
import type { AppSession } from "@/lib/session";

export type TreatmentCaseListItem = TreatmentServiceSummary & {
  patientName: string;
  patientCode: string | null;
};

export type TreatmentCasesWorkspaceModel = {
  cases: TreatmentCaseListItem[];
  treatmentCase: TreatmentCaseListItem | null;
  patient: Patient | null;
  clinicalNotes: ClinicalNoteSummary[];
  canProgress: boolean;
  canViewClinical: boolean;
  message: string | null;
};

export async function getTreatmentCasesWorkspace(
  session: AppSession,
  options: {
    patientId?: string | null;
    treatmentServiceId?: string | null;
  } = {},
): Promise<TreatmentCasesWorkspaceModel> {
  const patientWorkspace = await getPatientWorkspace(session);
  const patientById = new Map(
    patientWorkspace.patients.map((patient) => [patient.id, patient]),
  );
  const requestedPatient = options.patientId
    ? patientById.get(options.patientId) ?? null
    : null;

  const servicesWorkspace = await getServicesWorkspace(
    session,
    requestedPatient ? { patientId: requestedPatient.id } : {},
  );
  const cases = treatmentCasesForAccessiblePatients(
    servicesWorkspace,
    patientById,
  );
  const treatmentCase = options.treatmentServiceId
    ? cases.find((item) => item.id === options.treatmentServiceId) ?? null
    : null;
  const patient = treatmentCase
    ? patientById.get(treatmentCase.patientId) ?? null
    : requestedPatient;
  const canViewClinical = canAccessView(session, "clinical");
  const clinicalWorkspace = treatmentCase && patient && canViewClinical
    ? await getClinicalWorkspace(session, { patientId: patient.id })
    : null;

  return {
    cases,
    treatmentCase,
    patient,
    clinicalNotes: clinicalWorkspace?.notes ?? [],
    canProgress: canPerformAction(session, "treatment.service.progress"),
    canViewClinical,
    message: servicesWorkspace.message,
  };
}

function treatmentCasesForAccessiblePatients(
  workspace: ServicesWorkspace,
  patientById: Map<string, Patient>,
): TreatmentCaseListItem[] {
  return workspace.treatmentServices.flatMap((treatmentService) => {
    const patient = patientById.get(treatmentService.patientId);

    if (!patient) {
      return [];
    }

    return [
      {
        ...treatmentService,
        patientName: patient.name,
        patientCode: patient.patientCode || null,
      },
    ];
  });
}

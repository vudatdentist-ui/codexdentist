import "server-only";

import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { fhirExportEnabled } from "@/lib/env";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { toFhirPatient } from "@/integrations/fhir/patient";

export async function exportFhirPatientCommand(session: AppSession, patientId: string) {
  if (!fhirExportEnabled()) throw new ApplicationCommandError("fhir-export-disabled");
  if (!canPerformAction(session, "interop.patient.export")) throw new ApplicationCommandError("fhir-export-denied");
  const patient = await prisma.patient.findFirst({
    where: { ...patientAccessWhere(session), id: patientId },
    select: { id: true, fullName: true, dateOfBirth: true, gender: true, phone: true, email: true, address: true },
  });
  if (!patient) throw new ApplicationCommandError("fhir-patient-not-found");
  return toFhirPatient(patient);
}

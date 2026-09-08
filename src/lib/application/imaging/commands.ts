import "server-only";

import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import {
  findActiveIntegrationConnection,
  getIntegrationConnectionById,
} from "@/infrastructure/integrations/phase3-store";
import {
  getImagingStudyForScope,
  listImagingStudies,
  upsertImagingStudy,
} from "@/infrastructure/imaging/store";
import { fetchOrthancStudy } from "@/integrations/orthanc/client";
import { resolveOrthancConnectionSecrets } from "@/integrations/config";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { buildOhifStudyUrl } from "@/integrations/orthanc/client";

export async function linkOrthancStudyCommand(
  session: AppSession,
  input: { patientId: string; externalStudyId: string },
) {
  requireAction(session, "imaging.study.link", "imaging-link-denied");
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true, clinicId: true },
  });
  if (!patient) throw new ApplicationCommandError("imaging-patient-not-found");

  const connection = await findActiveIntegrationConnection(prisma, {
    organizationId: session.organizationId,
    clinicId: patient.clinicId,
    provider: "orthanc",
  });
  if (!connection) throw new ApplicationCommandError("imaging-connection-not-configured");

  let remote;
  try {
    remote = await fetchOrthancStudy(
      resolveOrthancConnectionSecrets(connection.secretRef),
      input.externalStudyId,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "orthanc-unavailable";
    throw new ApplicationCommandError(code.startsWith("orthanc-") ? code : "orthanc-unavailable");
  }

  const study = await upsertImagingStudy({
    organizationId: session.organizationId,
    clinicId: patient.clinicId,
    patientId: patient.id,
    connectionId: connection.id,
    provider: "orthanc",
    externalStudyId: remote.externalStudyId,
    externalPatientId: remote.externalPatientId,
    studyInstanceUid: remote.studyInstanceUid,
    accessionNumber: remote.accessionNumber,
    modalities: remote.modalities,
    studyDate: remote.studyDate ? new Date(`${remote.studyDate}T00:00:00.000Z`) : null,
    description: remote.description,
    createdById: databaseActorId(session.userId),
  });

  await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "imaging.study_linked",
      entityType: "ImagingStudy",
      entityId: study.id,
      metadata: {
        provider: "orthanc",
        clinicId: patient.clinicId,
        patientId: patient.id,
        externalStudyId: remote.externalStudyId,
        studyInstanceUid: remote.studyInstanceUid,
      },
    },
  });

  return study;
}

export async function listImagingStudiesCommand(
  session: AppSession,
  patientId?: string,
) {
  requireAction(session, "imaging.study.view", "imaging-view-denied");
  if (patientId) {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: { in: session.clinicIds },
      },
      select: { id: true },
    });
    if (!patient) throw new ApplicationCommandError("imaging-patient-not-found");
  }
  return listImagingStudies({
    organizationId: session.organizationId,
    clinicIds: session.clinicIds,
    patientId,
  });
}

export async function getImagingViewerCommand(session: AppSession, studyId: string) {
  requireAction(session, "imaging.study.view", "imaging-view-denied");
  const study = await getImagingStudyForScope({
    id: studyId,
    organizationId: session.organizationId,
    clinicIds: session.clinicIds,
  });
  if (!study) throw new ApplicationCommandError("imaging-study-not-found");
  if (!study.studyInstanceUid) throw new ApplicationCommandError("imaging-study-uid-missing");

  const connection = await getIntegrationConnectionById(prisma, study.connectionId, "orthanc");
  if (
    !connection ||
    connection.status !== "ACTIVE" ||
    connection.organizationId !== session.organizationId ||
    (connection.clinicId !== null && connection.clinicId !== study.clinicId)
  ) {
    throw new ApplicationCommandError("imaging-connection-unavailable");
  }
  const secrets = resolveOrthancConnectionSecrets(connection.secretRef);
  const viewerUrl = buildOhifStudyUrl(secrets.viewerBaseUrl, study.studyInstanceUid);
  if (!viewerUrl) throw new ApplicationCommandError("imaging-viewer-not-configured");
  return { study, viewerUrl };
}

function requireAction(
  session: AppSession,
  action: Parameters<typeof canPerformAction>[1],
  code: string,
) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError(code);
}

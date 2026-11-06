import "server-only";

import { canPerformAction } from "@/lib/actions/permissions";
import { ApplicationCommandError } from "@/lib/application/errors";
import { databaseActorId } from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import {
  findActiveIntegrationConnection,
  getIntegrationConnectionById,
} from "@/infrastructure/integrations/phase3-store";
import { createExternalReference, IntegrationScopeError } from "@/infrastructure/integrations/substrate";
import {
  getImagingStudyForScope,
  imagingStudySelect,
  listImagingStudies,
  createImagingStudy,
  updateImagingStudyAvailability,
} from "@/infrastructure/imaging/store";
import { fetchOrthancStudy } from "@/integrations/orthanc/client";
import { IntegrationConfigurationError } from "@/integrations/config";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { safeErrorCode } from "@/shared/error-codes";
import { resolveImagingConnection } from "@/lib/application/imaging/connection";
import { isDicomUid } from "@/integrations/orthanc/dicomweb-policy";

export async function linkOrthancStudyCommand(
  session: AppSession,
  input: { patientId: string; externalStudyId: string },
) {
  requireAction(session, "imaging.study.link", "imaging-link-denied");
  const clinicIds = allowedClinicIds(session);
  const patient = await prisma.patient.findFirst({
    where: {
      id: input.patientId,
      organizationId: session.organizationId,
      clinicId: { in: clinicIds },
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
    remote = await fetchOrthancStudy(await resolveImagingConnection(session, connection, patient.clinicId), input.externalStudyId);
  } catch (error) {
    const code = error instanceof IntegrationConfigurationError
      ? error.code
      : safeErrorCode(error, "orthanc-unavailable");
    throw new ApplicationCommandError(code.startsWith("orthanc-") ? code : "orthanc-unavailable");
  }
  if (!isDicomUid(remote.studyInstanceUid)) throw new ApplicationCommandError("orthanc-study-uid-missing");
  const externalPatientId = remote.externalPatientId;
  if (!externalPatientId) throw new ApplicationCommandError("orthanc-patient-id-missing");

  const study = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${session.organizationId}:${connection.id}:${remote.externalStudyId}`}))`;
    const existing = await tx.imagingStudy.findUnique({
      where: {
        organizationId_connectionId_externalStudyId: {
          organizationId: session.organizationId,
          connectionId: connection.id,
          externalStudyId: remote.externalStudyId,
        },
      },
      select: { patientId: true, clinicId: true },
    });
    if (existing && (existing.patientId !== patient.id || existing.clinicId !== patient.clinicId)) {
      throw new ApplicationCommandError("imaging-study-already-linked");
    }
    try {
      await createExternalReference(tx, {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        connectionId: connection.id,
        provider: "orthanc",
        entityType: "Patient",
        internalId: patient.id,
        externalId: externalPatientId,
        metadata: { source: "imaging-study-link" },
      });
    } catch (error) {
      if (error instanceof IntegrationScopeError) throw new ApplicationCommandError(error.code);
      throw error;
    }
    if (existing) {
      return tx.imagingStudy.findUniqueOrThrow({
        where: { organizationId_connectionId_externalStudyId: {
          organizationId: session.organizationId,
          connectionId: connection.id,
          externalStudyId: remote.externalStudyId,
        } },
        select: imagingStudySelect,
      });
    }
    const created = await createImagingStudy(tx, {
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
    await tx.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "imaging.study_linked",
        entityType: "ImagingStudy",
        entityId: created.id,
        metadata: { provider: "orthanc", clinicId: patient.clinicId, patientId: patient.id, externalStudyId: remote.externalStudyId, studyInstanceUid: remote.studyInstanceUid },
      },
    });
    return created;
  });

  return study;
}

export async function listImagingStudiesCommand(
  session: AppSession,
  patientId?: string,
) {
  requireAction(session, "imaging.study.view", "imaging-view-denied");
  const clinicIds = allowedClinicIds(session);
  if (patientId) {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: { in: clinicIds },
      },
      select: { id: true },
    });
    if (!patient) throw new ApplicationCommandError("imaging-patient-not-found");
  }
  return listImagingStudies({
    organizationId: session.organizationId,
    clinicIds,
    patientId,
  });
}

export async function getImagingViewerCommand(session: AppSession, studyId: string) {
  const { study } = await authorizeImagingStudy(session, studyId);
  if (!process.env.OPTIONAL_OHIF_BASE_URL?.trim()) throw new ApplicationCommandError("imaging-viewer-not-configured");
  const viewerUrl = `/imaging/ohif/viewer?${new URLSearchParams({ studyId: study.id, StudyInstanceUIDs: study.studyInstanceUid! })}`;
  await updateImagingStudyAvailability(prisma, { id: study.id, availability: "AVAILABLE" });
  return { study, viewerUrl };
}

/** Called on every PHI response, including metadata, bulkdata and individual frames. */
export async function authorizeImagingStudy(session: AppSession, studyId: string, expectedStudyUid?: string) {
  requireAction(session, "imaging.study.view", "imaging-view-denied");
  if (session.isDemo) throw new ApplicationCommandError("imaging-demo-unavailable");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(studyId)) throw new ApplicationCommandError("imaging-study-not-found");
  const clinicIds = allowedClinicIds(session);
  const study = await getImagingStudyForScope({
    id: studyId,
    organizationId: session.organizationId,
    clinicIds,
  });
  if (!study) throw new ApplicationCommandError("imaging-study-not-found");
  if (study.provider !== "orthanc") throw new ApplicationCommandError("imaging-study-not-found");
  if (!isDicomUid(study.studyInstanceUid)) throw new ApplicationCommandError("imaging-study-uid-missing");
  if (expectedStudyUid !== undefined && expectedStudyUid !== study.studyInstanceUid) throw new ApplicationCommandError("imaging-dicomweb-request-invalid");

  const connection = await getIntegrationConnectionById(prisma, study.connectionId, "orthanc");
  if (
    !connection ||
    connection.status !== "ACTIVE" ||
    connection.organizationId !== session.organizationId ||
    (connection.clinicId !== null && connection.clinicId !== study.clinicId)
  ) {
    throw new ApplicationCommandError("imaging-connection-unavailable");
  }
  let secrets;
  try {
    secrets = await resolveImagingConnection(session, connection, study.clinicId);
    if (secrets.viewerAccessMode !== "private") {
      throw new ApplicationCommandError("imaging-viewer-access-not-configured");
    }
    const remote = await fetchOrthancStudy(secrets, study.externalStudyId);
    if (
      remote.externalStudyId !== study.externalStudyId ||
      remote.externalPatientId !== study.externalPatientId ||
      remote.studyInstanceUid !== study.studyInstanceUid
    ) {
      await updateImagingStudyAvailability(prisma, {
        id: study.id,
        availability: "UNAVAILABLE",
        lastErrorCode: "orthanc-study-identity-mismatch",
      });
      throw new ApplicationCommandError("orthanc-study-identity-mismatch");
    }
  } catch (error) {
    if (error instanceof ApplicationCommandError) throw error;
    const code = error instanceof IntegrationConfigurationError
      ? error.code
      : safeErrorCode(error, "orthanc-unavailable");
    await updateImagingStudyAvailability(prisma, { id: study.id, availability: "UNAVAILABLE", lastErrorCode: code });
    throw new ApplicationCommandError(code.startsWith("orthanc-") ? code : "orthanc-unavailable");
  }
  return { study, secrets };
}

function requireAction(
  session: AppSession,
  action: Parameters<typeof canPerformAction>[1],
  code: string,
) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError(code);
}

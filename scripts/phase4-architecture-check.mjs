import { readFile } from "node:fs/promises";

const files = {
  schema: "prisma/schema.prisma",
  migration: "prisma/migrations/20260908090000_imaging_studies/migration.sql",
  client: "src/integrations/orthanc/client.ts",
  config: "src/integrations/config.ts",
  store: "src/infrastructure/imaging/store.ts",
  commands: "src/lib/application/imaging/commands.ts",
  connections: "src/app/api/integrations/connections/route.ts",
  studies: "src/app/api/imaging/studies/route.ts",
  viewer: "src/app/api/imaging/studies/[studyId]/viewer/route.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

assert(source.schema.includes("model ImagingStudy"), "ImagingStudy is modeled explicitly");
assert(
  source.schema.includes("externalStudyId") &&
    source.schema.includes("studyInstanceUid") &&
    !/dicom|pixeldata|blob/i.test(source.schema.slice(source.schema.indexOf("model ImagingStudy"), source.schema.indexOf("model PatientJourneyState"))),
  "imaging model stores references and metadata, not DICOM blobs",
);
assert(
  source.migration.includes('CREATE TABLE "ImagingStudy"') &&
    source.migration.includes('"organizationId"') &&
    source.migration.includes('"clinicId"') &&
    source.migration.includes('"patientId"'),
  "imaging migration is tenant, clinic, and patient scoped",
);
assert(
  /clinic\s+Clinic\s+@relation\(fields: \[clinicId, organizationId\]/.test(source.schema) &&
    /patient\s+Patient\s+@relation\(fields: \[patientId, clinicId, organizationId\]/.test(source.schema) &&
    source.schema.includes('@@unique([id, clinicId, organizationId])') &&
    source.schema.includes('@@unique([id, organizationId])'),
  "imaging references enforce composite tenant and clinic consistency",
);
assert(!/@prisma|lib\/prisma|infrastructure\//.test(source.client), "Orthanc client is provider-only");
assert(
  source.client.includes("ParentPatient") &&
    source.client.includes("StudyInstanceUID") &&
    !source.client.includes("PatientName"),
  "Orthanc mapping uses stable IDs and minimizes patient metadata",
);
assert(
  source.commands.includes('organizationId: session.organizationId') &&
    source.commands.includes("allowedClinicIds(session)") &&
    source.commands.includes('provider: "orthanc"'),
  "imaging commands enforce tenant and clinic scope",
);
assert(
  source.studies.includes("listImagingStudiesCommand(session, patientId)") &&
    source.studies.includes("linkOrthancStudyCommand(session") &&
    source.viewer.includes("getImagingViewerCommand(session, studyId)"),
  "imaging routes dispatch through application commands",
);
assert(
    source.commands.includes("imaging-viewer-not-configured") &&
    source.commands.includes("orthanc-study-identity-mismatch") &&
    source.commands.includes("buildOhifStudyUrl") &&
    source.commands.includes("connection.organizationId !== session.organizationId") &&
    source.commands.includes("connection.clinicId !== study.clinicId"),
  "unavailable or unconfigured OHIF fails closed",
);
assert(source.connections.includes('"orthanc"'), "Orthanc connection configuration is explicit");

console.log("phase4-architecture-check: ok");

function assert(condition, label) {
  if (!condition) throw new Error(`Phase4 architecture check failed: ${label}`);
  console.log(`ok ${label}`);
}

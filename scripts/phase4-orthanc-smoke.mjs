const {
  buildOhifStudyUrl,
  fetchOrthancStudy,
  OrthancProviderError,
} = await import("../src/integrations/orthanc/client.ts");

const originalFetch = globalThis.fetch;
const secrets = {
  baseUrl: "http://orthanc.test",
  viewerBaseUrl: "http://ohif.test/viewer",
  username: "orthanc-user",
  password: "orthanc-password",
};

try {
  globalThis.fetch = async (url, init = {}) => {
    assert(String(url) === "http://orthanc.test/studies/study-123", "Orthanc study endpoint is scoped to the study id");
    assert(init.headers.get("Authorization") === `Basic ${Buffer.from("orthanc-user:orthanc-password").toString("base64")}`, "Orthanc credentials use basic auth");
    return new Response(JSON.stringify({
      ID: "study-123",
      ParentPatient: "patient-resource-123",
      MainDicomTags: {
        StudyInstanceUID: "1.2.840.113619.2.55.3.604688123.123",
        AccessionNumber: "ACC-123",
        ModalitiesInStudy: "CT\\MR",
        StudyDate: "20260908",
        StudyDescription: "Dental CBCT",
        PatientName: "Must never leave the provider adapter",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const study = await fetchOrthancStudy(secrets, "study-123");
  assert(study.externalStudyId === "study-123", "Orthanc study id is retained as an external reference");
  assert(study.externalPatientId === "patient-resource-123", "Orthanc patient mapping uses stable provider id");
  assert(study.studyInstanceUid.startsWith("1.2.840."), "StudyInstanceUID is retained for OHIF");
  assert(study.modalities.join(",") === "CT,MR", "Orthanc modalities are normalized");
  assert(study.studyDate === "2026-09-08", "Orthanc study date is normalized");
  assert(!Object.hasOwn(study, "patientName"), "PHI-heavy DICOM tags are not returned");

  const viewerUrl = buildOhifStudyUrl(secrets.viewerBaseUrl, study.studyInstanceUid);
  assert(viewerUrl === `http://ohif.test/viewer?StudyInstanceUIDs=${encodeURIComponent(study.studyInstanceUid)}`, "OHIF URL carries only the stable study UID");
  assert(buildOhifStudyUrl(null, study.studyInstanceUid) === null, "OHIF fails closed when no viewer is configured");

  let invalidDenied = false;
  try {
    await fetchOrthancStudy(secrets, "study/../../patient");
  } catch (error) {
    invalidDenied = error instanceof OrthancProviderError && error.code === "orthanc-study-id-invalid";
  }
  assert(invalidDenied, "Orthanc study path traversal is rejected");

  globalThis.fetch = async () => { throw new Error("connection refused"); };
  let unavailable = false;
  try {
    await fetchOrthancStudy(secrets, "study-123");
  } catch (error) {
    unavailable = error instanceof OrthancProviderError && error.code === "orthanc-unavailable";
  }
  assert(unavailable, "PACS outage is represented as an actionable provider error");
  console.log("ok phase4 Orthanc/OHIF smoke");
} finally {
  globalThis.fetch = originalFetch;
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase4 Orthanc smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

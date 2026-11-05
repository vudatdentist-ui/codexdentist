const {
  buildOhifStudyUrl,
  fetchOrthancStudy,
  OrthancProviderError,
} = await import("../src/integrations/orthanc/client.ts");
const { resolveOrthancConnectionSecrets } = await import("../src/integrations/config.ts");

const originalFetch = globalThis.fetch;
const fixtureEnvironment = {
  ORTHANC_DEFAULT_ORGANIZATION_ID: "synthetic-orthanc-organization",
  ORTHANC_DEFAULT_BASE_URL: "https://orthanc.test",
  ORTHANC_DEFAULT_VIEWER_BASE_URL: "https://ohif.test/viewer",
  ORTHANC_DEFAULT_VIEWER_ACCESS_MODE: "private",
  ORTHANC_DEFAULT_USERNAME: "orthanc-user",
  ORTHANC_DEFAULT_PASSWORD: "orthanc-password",
};
const previousEnvironment = Object.fromEntries(Object.keys(fixtureEnvironment).map(key => [key, process.env[key]]));

try {
  Object.assign(process.env, fixtureEnvironment);
  const secrets = resolveOrthancConnectionSecrets({
    organizationId: fixtureEnvironment.ORTHANC_DEFAULT_ORGANIZATION_ID,
    secretRef: "env:ORTHANC_DEFAULT",
  });
  globalThis.fetch = async (url, init = {}) => {
    const studyId = decodeURIComponent(String(url).split("/").pop());
    assert(String(url) === `https://orthanc.test/studies/${studyId}`, "Orthanc study endpoint is scoped to the study id");
    assert(init.headers.get("Authorization") === `Basic ${Buffer.from("orthanc-user:orthanc-password").toString("base64")}`, "Orthanc credentials use basic auth");
    if (studyId === "missing-study") return new Response("not found", { status: 404 });
    const tags = {
      StudyInstanceUID: studyId === "bad-date-study" ? "1.2.3.bad-date" : "1.2.840.113619.2.55.3.604688123.123",
      AccessionNumber: "ACC-123",
      ModalitiesInStudy: "CT\\MR",
      StudyDate: studyId === "bad-date-study" ? "20260230" : "20260908",
      StudyDescription: "Dental CBCT",
      PatientName: "Must never leave the provider adapter",
    };
    return new Response(JSON.stringify({
      ID: studyId,
      ...(studyId === "missing-patient-study" ? {} : { ParentPatient: "patient-resource-123" }),
      MainDicomTags: tags,
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
  assert(viewerUrl === `https://ohif.test/viewer?StudyInstanceUIDs=${encodeURIComponent(study.studyInstanceUid)}`, "OHIF URL carries only the stable study UID");
  assert(buildOhifStudyUrl(null, study.studyInstanceUid) === null, "OHIF fails closed when no viewer is configured");

  let missingStudy = false;
  try {
    await fetchOrthancStudy(secrets, "missing-study");
  } catch (error) {
    missingStudy = error instanceof OrthancProviderError && error.code === "orthanc-study-not-found";
  }
  assert(missingStudy, "PACS 404 is represented as study-not-found");

  let missingPatient = false;
  try {
    await fetchOrthancStudy(secrets, "missing-patient-study");
  } catch (error) {
    missingPatient = error instanceof OrthancProviderError && error.code === "orthanc-patient-id-missing";
  }
  assert(missingPatient, "DICOM study without provider patient mapping is rejected");

  const invalidDateStudy = await fetchOrthancStudy(secrets, "bad-date-study");
  assert(invalidDateStudy.studyDate === null, "invalid calendar dates are not normalized");

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
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase4 Orthanc smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

import "server-only";

export type OrthancConnectionSecrets = {
  baseUrl: string;
  viewerBaseUrl: string | null;
  viewerAccessMode: "private" | "disabled";
  username: string | null;
  password: string | null;
};

export type OrthancStudyMetadata = {
  externalStudyId: string;
  externalPatientId: string | null;
  studyInstanceUid: string;
  accessionNumber: string | null;
  modalities: string[];
  studyDate: string | null;
  description: string | null;
};

export async function fetchOrthancStudy(
  secrets: OrthancConnectionSecrets,
  externalStudyId: string,
): Promise<OrthancStudyMetadata> {
  const studyId = normalizeOrthancId(externalStudyId);
  const headers = new Headers({ Accept: "application/json" });
  if (secrets.username && secrets.password) {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString("base64")}`,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${secrets.baseUrl}/studies/${encodeURIComponent(studyId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new OrthancProviderError("orthanc-unavailable", 503);
  }

  if (response.status === 404) throw new OrthancProviderError("orthanc-study-not-found", 404);
  if (!response.ok) throw new OrthancProviderError("orthanc-request-failed", 503);

  const body = await response.json().catch(() => null);
  return normalizeOrthancStudy(body, studyId);
}

export function buildOhifStudyUrl(viewerBaseUrl: string | null, studyInstanceUid: string) {
  if (!viewerBaseUrl) return null;
  const url = new URL(viewerBaseUrl);
  url.searchParams.set("StudyInstanceUIDs", studyInstanceUid);
  return url.toString();
}

function normalizeOrthancId(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new OrthancProviderError("orthanc-study-id-invalid", 400);
  }
  return normalized;
}

function normalizeOrthancStudy(value: unknown, externalStudyId: string): OrthancStudyMetadata {
  const record = asRecord(value);
  const tags = asRecord(record.MainDicomTags);
  const studyInstanceUid = stringValue(tags.StudyInstanceUID);
  if (!studyInstanceUid) throw new OrthancProviderError("orthanc-study-uid-missing", 502);
  const externalPatientId = stringValue(record.ParentPatient);
  if (!externalPatientId) throw new OrthancProviderError("orthanc-patient-id-missing", 502);

  return {
    externalStudyId,
    externalPatientId,
    studyInstanceUid,
    accessionNumber: stringValue(tags.AccessionNumber),
    modalities: stringList(tags.ModalitiesInStudy),
    studyDate: normalizeStudyDate(stringValue(tags.StudyDate)),
    description: stringValue(tags.StudyDescription),
  };
}

function normalizeStudyDate(value: string | null) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").slice(0, 20);
  if (typeof value === "string") return value.split("\\").map((item) => item.trim()).filter(Boolean).slice(0, 20);
  return [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class OrthancProviderError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "OrthancProviderError";
  }
}

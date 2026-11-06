import "server-only";
import { OrthancProviderError } from "@/integrations/orthanc/client";

const invalid = (): never => { throw new OrthancProviderError("imaging-dicomweb-request-invalid", 400); };
export function isDicomUid(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && /^(0|[1-9]\d*)(\.(0|[1-9]\d*))+$/u.test(value);
}

export type DicomwebRequest = { path: string; query: string; json: boolean; seriesUid?: string; instanceUid?: string };

/** Deliberately no PACS root, unrestricted study search, STOW, WADO-URI or REST API. */
export function validateDicomwebRequest(parts: string[], query: URLSearchParams, studyUid: string): DicomwebRequest {
  if (!isDicomUid(studyUid) || parts.length > 24 || parts.some(p => !p || p === "." || p === ".." || /[%\\/?#\s]/u.test(p))) invalid();
  let json = true;
  let seriesUid: string | undefined;
  let instanceUid: string | undefined;
  if (parts[0] !== "studies") invalid();
  const rootSearch = parts.length === 1;
  if (!rootSearch) {
    if (parts[1] !== studyUid) invalid();
    const tail = parts.slice(2);
    if (tail.length === 1 && ["metadata", "series", "instances"].includes(tail[0]!)) {
      // Study-scoped metadata or QIDO.
    } else if (tail[0] === "series" && isDicomUid(tail[1])) {
      seriesUid = tail[1];
      const instance = tail.slice(2);
      if (instance.length === 1 && ["metadata", "instances"].includes(instance[0]!)) {
        // Series-scoped metadata or QIDO.
      } else if (instance[0] === "instances" && isDicomUid(instance[1])) {
        instanceUid = instance[1];
        const resource = instance.slice(2);
        if (!resource.length) json = false;
        else if (resource.length === 1 && resource[0] === "metadata") json = true;
        else if (resource.length === 2 && resource[0] === "frames" &&
          /^[1-9]\d{0,6}(,[1-9]\d{0,6}){0,255}$/u.test(resource[1]!)) json = false;
        else if (resource[0] === "bulk" && resource.length >= 2 && resource.length % 2 === 0 &&
          resource.slice(1).every((v, i) => i % 2 === 0 ? /^[0-9a-fA-F]{8}$/u.test(v) : /^[1-9]\d{0,6}$/u.test(v))) json = false;
        else invalid();
      } else invalid();
    } else invalid();
  }
  const normalized = new URLSearchParams();
  const seen = new Set<string>();
  for (const [name, value] of query) {
    // OHIF/dicomweb-client can request repeated includefield entries.
    const key = name.toLowerCase();
    if (key !== "includefield" && seen.has(key)) invalid();
    seen.add(key);
    if (query.toString().length > 4096) invalid();
    if (key === "studyinstanceuid" || key === "0020000d") {
      if (value !== studyUid) invalid();
    } else if (key === "seriesinstanceuid" || key === "0020000e") {
      if (!isDicomUid(value) || (seriesUid && value !== seriesUid)) invalid();
    } else if (key === "sopinstanceuid" || key === "00080018") {
      if (!isDicomUid(value) || (instanceUid && value !== instanceUid)) invalid();
    } else if (key === "includefield") {
      if (!/^(all|[A-Za-z][A-Za-z0-9]{0,63}|[0-9a-fA-F]{8})(,(all|[A-Za-z][A-Za-z0-9]{0,63}|[0-9a-fA-F]{8}))*$/u.test(value)) invalid();
    } else if (key === "limit" || key === "offset") {
      if (!/^\d{1,5}$/u.test(value) || Number(value) > 10000) invalid();
    } else if (key === "fuzzymatching") {
      if (value !== "false") invalid();
    } else invalid();
    // Query options are only for QIDO, never binary retrieval or metadata.
    if (!json || parts.at(-1) === "metadata") invalid();
    normalized.append(name, value);
  }
  // A UID-constrained QIDO is needed by OHIF, but a global PACS study list is forbidden.
  if (rootSearch && !query.has("StudyInstanceUID") && !query.has("0020000D")) invalid();
  return { path: parts.join("/"), query: normalized.toString(), json, seriesUid, instanceUid };
}

/** Rewrite URLs from the trusted provider only; never relay a foreign bulk locator. */
export function rewriteDicomJson(
  value: unknown,
  context: { upstreamRoot: string; proxyRoot: string; studyUid: string; request: DicomwebRequest },
): unknown {
  if (!Array.isArray(value)) throw new OrthancProviderError("orthanc-dicomweb-response-invalid", 502);
  const root = new URL(`${context.upstreamRoot}/`);
  const rewrite = (uri: unknown) => {
    if (typeof uri !== "string" || /[%\\\s]/u.test(uri) || uri.startsWith("//") || uri.split("/").some(p => p === "." || p === "..")) {
      throw new OrthancProviderError("orthanc-bulk-uri-denied", 502);
    }
    let url: URL;
    try { url = new URL(uri, root); } catch { throw new OrthancProviderError("orthanc-bulk-uri-denied", 502); }
    if (url.origin !== root.origin || url.username || url.password || url.hash || url.search || !url.pathname.startsWith(root.pathname)) {
      throw new OrthancProviderError("orthanc-bulk-uri-denied", 502);
    }
    const path = url.pathname.slice(root.pathname.length).split("/");
    let target: DicomwebRequest;
    try { target = validateDicomwebRequest(path, new URLSearchParams(), context.studyUid); }
    catch { throw new OrthancProviderError("orthanc-bulk-uri-denied", 502); }
    if (target.json || !path.includes("bulk") ||
        (context.request.seriesUid && target.seriesUid !== context.request.seriesUid) ||
        (context.request.instanceUid && target.instanceUid !== context.request.instanceUid)) {
      throw new OrthancProviderError("orthanc-bulk-uri-denied", 502);
    }
    return `${context.proxyRoot}/${target.path}`;
  };
  let nodes = 0;
  const walk = (node: unknown, depth: number): unknown => {
    if (++nodes > 500000 || depth > 32) throw new OrthancProviderError("orthanc-dicomweb-response-invalid", 502);
    if (Array.isArray(node)) return node.map(item => walk(item, depth + 1));
    if (!node || typeof node !== "object") return node;
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(node)) {
      if (key === "BulkDataURI" || key === "RetrieveURL") result[key] = rewrite(entry);
      // Retrieve URL DICOM tags may carry an internal or attacker-controlled URL.
      else if (key === "00081190" || key === "00081195") continue;
      else result[key] = walk(entry, depth + 1);
    }
    return result;
  };
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new OrthancProviderError("orthanc-dicomweb-response-invalid", 502);
    const record = item as Record<string, { Value?: unknown[] }>;
    for (const [tag, expected] of [["0020000D", context.studyUid], ["0020000E", context.request.seriesUid], ["00080018", context.request.instanceUid]] as const) {
      if (expected && record[tag] && (record[tag].Value?.length !== 1 || record[tag].Value?.[0] !== expected)) {
        throw new OrthancProviderError("orthanc-dicomweb-identity-mismatch", 502);
      }
    }
  }
  return walk(value, 0);
}

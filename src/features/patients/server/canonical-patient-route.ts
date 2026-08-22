import "server-only";

type PatientRouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export function canonicalPatientRoute(searchParams?: PatientRouteSearchParams) {
  const patientId = firstValue(searchParams?.patientId)?.trim() ?? "";
  const query = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
    if (key === "patientId" || rawValue === undefined) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => query.append(key, value));
      continue;
    }

    query.set(key, rawValue);
  }

  const pathname = patientId
    ? `/patients/${encodeURIComponent(patientId)}`
    : "/patients";
  const queryString = query.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const migrationQaRoutes = Object.freeze([
  "/today",
  "/work",
  "/schedule",
  "/care",
  "/patients/[patientId]",
  "/treatment",
  "/patients/[patientId]/treatments/[treatmentServiceId]",
  "/operations",
  "/operations/finance",
  "/employee-app",
]);

const migrationQaRouteSet = new Set(migrationQaRoutes);

export function enabledMigrationRoutes(value, envName) {
  if (!value?.trim()) return [];

  const routes = value
    .split(",")
    .map(normalizeRoute)
    .filter(Boolean);
  const unsupported = routes.filter((route) => !migrationQaRouteSet.has(route));

  if (unsupported.length > 0) {
    throw new Error(
      `${envName} contains unsupported migration route(s): ${unsupported.join(", ")}. ` +
        `Allowed: ${migrationQaRoutes.join(", ")}.`,
    );
  }

  return [...new Set(routes)];
}

export function routeNeedsPatientId(route) {
  return normalizeRoute(route).includes("[patientId]");
}

export function routeNeedsTreatmentServiceId(route) {
  return normalizeRoute(route).includes("[treatmentServiceId]");
}

export function materializePatientRoute(route, patientId) {
  const normalized = normalizeRoute(route);

  if (!routeNeedsPatientId(normalized)) return normalized;
  if (!patientId?.trim()) {
    throw new Error(
      `Cannot resolve ${normalized}: set QA_PATIENT_ID (or the script-specific patient id env) ` +
        "or ensure /patients renders a patient detail link.",
    );
  }

  return normalized.replace("[patientId]", encodeURIComponent(patientId.trim()));
}

export function materializeTreatmentCaseRoute(
  route,
  patientId,
  treatmentServiceId,
) {
  const normalized = materializePatientRoute(route, patientId);

  if (!routeNeedsTreatmentServiceId(normalized)) return normalized;
  if (!treatmentServiceId?.trim()) {
    throw new Error(
      `Cannot resolve ${normalizeRoute(route)}: set QA_TREATMENT_SERVICE_ID ` +
        "or ensure /treatment renders a canonical treatment-case link.",
    );
  }

  return normalized.replace(
    "[treatmentServiceId]",
    encodeURIComponent(treatmentServiceId.trim()),
  );
}

export function normalizeRoute(route) {
  const trimmed = route?.trim();
  if (!trimmed) return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

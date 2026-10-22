import "server-only";
import { randomUUID } from "node:crypto";

/** Operational correlation without logging messages, stack traces or request data. */
export function reportApplicationError(area: string, error: unknown) {
  if (error && typeof error === "object" && "digest" in error &&
      String(error.digest).startsWith("NEXT_REDIRECT")) return null;
  const incidentId = randomUUID();
  const code = error && typeof error === "object" && "code" in error &&
    /^P\d{4}$/.test(String(error.code)) ? String(error.code) : "UNEXPECTED";
  console.error("application.error", { area, incidentId, code });
  return incidentId;
}

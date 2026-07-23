import "server-only";

import { demoAuthEnabled } from "@/lib/env";

export function demoFallbackAllowed() {
  return process.env.NODE_ENV !== "production" && demoAuthEnabled();
}

export function assertDemoFallbackAllowed(error: unknown, area: string) {
  if (demoFallbackAllowed()) {
    return;
  }

  console.error(`${area}.database_unavailable`, error);
  throw new Error(`${area}: database is required outside demo development mode.`);
}

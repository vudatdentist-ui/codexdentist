import "server-only";

import { timingSafeEqual } from "crypto";
import { jobSecret } from "@/lib/env";

export function verifyJobRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const headerToken = request.headers.get("x-job-secret")?.trim() ?? "";
  const provided = bearerToken || headerToken;

  return safeEqual(provided, jobSecret());
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

import { NextResponse } from "next/server";

/** A provider must keep delivering until durable processing has succeeded. */
export function inboxRetryResponse(provider: string, status: string) {
  if (status === "processed" || status === "already_processed") return null;
  return NextResponse.json({ error: `${provider}-inbox-${status === "failed" ? "failed" : "retry-pending"}` }, {
    status: 503,
    headers: { "cache-control": "no-store", "retry-after": "5" },
  });
}

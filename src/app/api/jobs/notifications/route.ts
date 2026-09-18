import { NextResponse } from "next/server";
import { verifyJobRequest } from "@/lib/job-auth";
import { processDueNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  try {
    const result = await processDueNotifications({ limit });

    return json(result);
  } catch (error) {
    console.error("notification_job.failed", error);

    return json({ error: "Notification job failed" }, { status: 500 });
  }
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

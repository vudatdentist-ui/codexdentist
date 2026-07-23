import { NextResponse } from "next/server";
import { verifyJobRequest } from "@/lib/job-auth";
import { processDueNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  try {
    const result = await processDueNotifications({ limit });

    return NextResponse.json(result);
  } catch (error) {
    console.error("notification_job.failed", error);

    return NextResponse.json({ error: "Notification job failed" }, { status: 500 });
  }
}

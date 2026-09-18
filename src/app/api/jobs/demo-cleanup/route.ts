import { NextResponse } from "next/server";
import { cleanupExpiredDemoWorkspaces } from "@/lib/demo-workspaces";
import { verifyJobRequest } from "@/lib/job-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return json(await cleanupExpiredDemoWorkspaces());
  } catch (error) {
    console.error("demo_cleanup.failed", error);

    return json({ error: "Demo cleanup failed" }, { status: 500 });
  }
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

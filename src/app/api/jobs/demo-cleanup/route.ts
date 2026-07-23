import { NextResponse } from "next/server";
import { cleanupExpiredDemoWorkspaces } from "@/lib/demo-workspaces";
import { verifyJobRequest } from "@/lib/job-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await cleanupExpiredDemoWorkspaces());
  } catch (error) {
    console.error("demo_cleanup.failed", error);

    return NextResponse.json({ error: "Demo cleanup failed" }, { status: 500 });
  }
}

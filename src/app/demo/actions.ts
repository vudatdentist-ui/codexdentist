"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { createDemoWorkspace } from "@/lib/demo-workspaces";
import { consumeDemoWorkspaceAttempt } from "@/lib/rate-limit";
import { currentHostname, systemSubdomainFromHostname } from "@/lib/tenant";

export async function startDemoWorkspaceAction() {
  const headerStore = await headers();
  const demoEntryPath =
    systemSubdomainFromHostname(await currentHostname()) === "demo" ? "/" : "/demo";
  const forwardedFor = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  const key = forwardedFor || realIp || "unknown";
  const limit = consumeDemoWorkspaceAttempt(key);

  if (!limit.allowed) {
    redirect(`${demoEntryPath}?error=rate-limited`);
  }

  let signedIn = false;

  try {
    const workspace = await createDemoWorkspace();
    const result = await signIn(workspace.owner.email, workspace.password, {
      allowNeutralDemo: true,
    });
    signedIn = result.ok;
  } catch (error) {
    console.error("demo_workspace.create_failed", error);
    redirect(`${demoEntryPath}?error=unavailable`);
  }

  if (!signedIn) {
    redirect(`${demoEntryPath}?error=session`);
  }

  redirect("/dashboard");
}

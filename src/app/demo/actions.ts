"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { createDemoWorkspace } from "@/lib/demo-workspaces";
import { consumeDemoWorkspaceAttempt } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-ip";
import { currentHostname, systemSubdomainFromHostname } from "@/lib/tenant";

export async function startDemoWorkspaceAction() {
  const headerStore = await headers();
  const demoEntryPath =
    systemSubdomainFromHostname(await currentHostname()) === "demo" ? "/" : "/demo";
  const key = clientIpFromHeaders(headerStore);
  const limit = await consumeDemoWorkspaceAttempt(key);

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

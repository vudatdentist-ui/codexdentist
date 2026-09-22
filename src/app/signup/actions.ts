"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { consumeTrialSignupAttempt } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-ip";
import {
  currentHostname,
  isLocalHostname,
  tenantDomainForSlug,
} from "@/lib/tenant";
import {
  createTrialWorkspace,
  TrialAccountAlreadyExistsError,
} from "@/lib/trial-workspaces";

export async function createTrialAccountAction(formData: FormData) {
  const clinicName = requiredString(formData.get("clinicName"));
  const city = requiredString(formData.get("city"));
  const ownerFullName = requiredString(formData.get("ownerFullName"));
  const ownerEmail = requiredString(formData.get("ownerEmail")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");

  if (
    clinicName.length < 2 ||
    city.length < 2 ||
    ownerFullName.length < 2 ||
    !ownerEmail.includes("@")
  ) {
    redirect("/signup?error=invalid");
  }

  if (password.length < 12) {
    redirect("/signup?error=password");
  }

  if (password !== passwordConfirmation) {
    redirect("/signup?error=password-confirmation");
  }

  const headerStore = await headers();
  const limit = await consumeTrialSignupAttempt(clientIpFromHeaders(headerStore));

  if (!limit.allowed) {
    redirect("/signup?error=rate-limited");
  }

  const hostname = await currentHostname();
  let workspaceSlug = "";
  let signedIn = false;

  try {
    const workspace = await createTrialWorkspace({
      clinicName,
      city,
      ownerEmail,
      ownerFullName,
      ownerPassword: password,
    });
    workspaceSlug = workspace.organization.slug ?? "";

    const result = await signIn(ownerEmail, password, {
      allowNeutralUser: true,
    });
    signedIn = result.ok;
  } catch (error) {
    if (error instanceof TrialAccountAlreadyExistsError) {
      redirect("/signup?error=account-exists");
    }

    console.error("trial_signup.failed", error);
    redirect("/signup?error=unavailable");
  }

  if (!workspaceSlug) {
    redirect("/signup?error=unavailable");
  }

  if (isLocalHostname(hostname)) {
    redirect(signedIn ? "/dashboard" : "/login?signup=created");
  }

  const workspaceUrl = `https://${tenantDomainForSlug(workspaceSlug)}`;
  redirect(
    signedIn
      ? `${workspaceUrl}/dashboard`
      : `${workspaceUrl}/login?signup=created`,
  );
}

function requiredString(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

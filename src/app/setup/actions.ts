"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { deploymentMode } from "@/lib/env";
import {
  createOrganizationWorkspace,
  FirstRunAlreadyCompletedError,
} from "@/lib/organization-onboarding";
import { prisma } from "@/lib/prisma";
import { isValidTenantSlug } from "@/lib/tenant";

export async function completeFirstRunSetupAction(formData: FormData) {
  if (deploymentMode() !== "self-hosted") {
    redirect("/");
  }

  if ((await prisma.organization.count()) > 0) {
    redirect("/login");
  }

  const organizationName = requiredString(formData.get("organizationName"));
  const clinicName = requiredString(formData.get("clinicName"));
  const city = requiredString(formData.get("city"));
  const address = requiredString(formData.get("address"));
  const ownerFullName = requiredString(formData.get("ownerFullName"));
  const ownerEmail = requiredString(formData.get("ownerEmail")).toLowerCase();
  const password = String(formData.get("password") ?? "");
  const passwordConfirmation = String(formData.get("passwordConfirmation") ?? "");
  const slug = slugify(organizationName);

  if (
    !organizationName ||
    !clinicName ||
    !city ||
    !address ||
    !ownerFullName ||
    !ownerEmail.includes("@") ||
    !isValidTenantSlug(slug)
  ) {
    redirect("/setup?error=invalid");
  }

  if (password.length < 12) {
    redirect("/setup?error=password");
  }

  if (password !== passwordConfirmation) {
    redirect("/setup?error=password-confirmation");
  }

  try {
    const workspace = await createOrganizationWorkspace({
      name: organizationName,
      slug,
      ownerEmail,
      ownerFullName,
      ownerPassword: password,
      clinicName,
      city,
      address,
      requireEmptyDatabase: true,
    });
    const result = await signIn(workspace.owner.email, password);

    if (!result.ok) {
      redirect("/login");
    }
  } catch (error) {
    if (error instanceof FirstRunAlreadyCompletedError) {
      redirect("/login");
    }

    console.error("first_run_setup.failed", error);
    redirect("/setup?error=failed");
  }

  redirect("/dashboard");
}

function requiredString(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

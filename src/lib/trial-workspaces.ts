import "server-only";

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createOrganizationWorkspace } from "@/lib/organization-onboarding";
import { prisma } from "@/lib/prisma";
import { isValidTenantSlug } from "@/lib/tenant";

export const TRIAL_DURATION_DAYS = 30;

export class TrialAccountAlreadyExistsError extends Error {
  constructor() {
    super("A trial account already exists for this email.");
    this.name = "TrialAccountAlreadyExistsError";
  }
}

export async function createTrialWorkspace(input: {
  clinicName: string;
  city: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerPassword: string;
}) {
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  if (
    await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    })
  ) {
    throw new TrialAccountAlreadyExistsError();
  }

  const trialEndsAt = new Date(
    Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = trialSlug(input.clinicName);

    try {
      const workspace = await createOrganizationWorkspace({
        name: input.clinicName,
        slug,
        ownerEmail,
        ownerFullName: input.ownerFullName,
        ownerPassword: input.ownerPassword,
        clinicName: input.clinicName,
        city: input.city,
        address: "Chưa cập nhật",
        trialEndsAt,
      });

      return {
        ...workspace,
        trialEndsAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map(String)
          : [];

        if (target.includes("email")) {
          throw new TrialAccountAlreadyExistsError();
        }

        if (target.includes("slug")) {
          continue;
        }
      }

      throw error;
    }
  }

  throw new Error("Could not allocate a unique trial workspace slug.");
}

function trialSlug(clinicName: string) {
  const base =
    clinicName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "phong-kham";
  const candidate = `${base}-${randomBytes(3).toString("hex")}`;

  return isValidTenantSlug(candidate)
    ? candidate
    : `clinic-${randomBytes(6).toString("hex")}`;
}

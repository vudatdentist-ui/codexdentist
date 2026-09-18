import { NextResponse } from "next/server";
import { generateCrmRecallTasks } from "@/lib/crm-recall";
import { verifyJobRequest } from "@/lib/job-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyJobRequest(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId : null;
  const requestedClinicIds = Array.isArray(body.clinicIds)
    ? body.clinicIds.filter((clinicId: unknown) => typeof clinicId === "string")
    : null;

  const organizations = await prisma.organization.findMany({
    where: organizationId ? { id: organizationId } : undefined,
    include: {
      clinics: {
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const results = [];

  for (const organization of organizations) {
    const organizationClinicIds = organization.clinics.map((clinic) => clinic.id);
    const clinicIds = requestedClinicIds
      ? organizationClinicIds.filter((clinicId) => requestedClinicIds.includes(clinicId))
      : organizationClinicIds;
    const result = await generateCrmRecallTasks({
      organizationId: organization.id,
      clinicIds,
      actorId: null,
    });

    results.push({
      organizationId: organization.id,
      clinicIds,
      createdCount: result.createdCount,
    });
  }

  return json({
    processedOrganizations: results.length,
    createdCount: results.reduce((sum, result) => sum + result.createdCount, 0),
    results,
  });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

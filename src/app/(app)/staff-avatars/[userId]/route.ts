import { requireSession } from "@/lib/auth";
import { openStoredPatientFileStream } from "@/lib/patient-file-storage";
import { canAccessView, canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ userId: string }>;
  },
) {
  const session = await requireSession();

  if (
    !canAccessView(session, "settings") &&
    !canAccessView(session, "staff") &&
    !canAccessView(session, "employee-app")
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const { userId } = await params;
  const variant = new URL(request.url).searchParams.get("variant");
  const staffProfile = await prisma.staffProfile.findFirst({
    where: {
      userId,
      organizationId: session.organizationId,
      avatarStorageProvider: {
        in: ["local", "r2"],
      },
      user: {
        clinics: {
          some: {
            clinicId: {
              in: allowedClinicIds(session),
            },
          },
        },
      },
    },
    select: {
      avatarFileName: true,
      avatarMimeType: true,
      avatarStorageKey: true,
      avatarStorageProvider: true,
      avatarThumbnailMimeType: true,
      avatarThumbnailStorageKey: true,
      user: {
        select: {
          fullName: true,
        },
      },
    },
  });

  if (!staffProfile?.avatarStorageKey) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const variantStorageKey =
      variant === "thumbnail" ? staffProfile.avatarThumbnailStorageKey : null;
    const variantMimeType =
      variant === "thumbnail" ? staffProfile.avatarThumbnailMimeType : null;
    const stored = await openStoredPatientFileStream({
      storageProvider: staffProfile.avatarStorageProvider,
      storageKey: variantStorageKey ?? staffProfile.avatarStorageKey,
      sourceId: variantStorageKey ?? staffProfile.avatarStorageKey,
    });
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeRFC5987(
        staffProfile.avatarFileName ?? `${staffProfile.user.fullName}-avatar`,
      )}`,
      "Content-Type": variantMimeType ?? staffProfile.avatarMimeType ?? "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    });

    if (stored.contentLength !== null) {
      headers.set("Content-Length", String(stored.contentLength));
    }

    return new Response(stored.body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function encodeRFC5987(value: string) {
  return encodeURIComponent(value)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
}

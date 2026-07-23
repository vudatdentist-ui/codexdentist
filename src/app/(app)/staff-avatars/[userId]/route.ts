import { requireSession } from "@/lib/auth";
import { readStoredPatientFile } from "@/lib/patient-file-storage";
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
    const bytes = await readStoredPatientFile({
      storageProvider: staffProfile.avatarStorageProvider,
      storageKey: variantStorageKey ?? staffProfile.avatarStorageKey,
      sourceId: variantStorageKey ?? staffProfile.avatarStorageKey,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeRFC5987(
          staffProfile.avatarFileName ?? `${staffProfile.user.fullName}-avatar`,
        )}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": variantMimeType ?? staffProfile.avatarMimeType ?? "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
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

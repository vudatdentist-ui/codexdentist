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
    params: Promise<{ assetId: string }>;
  },
) {
  const session = await requireSession();

  if (!canAccessView(session, "learning") && !canAccessView(session, "employee-app")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { assetId } = await params;
  const variant = new URL(request.url).searchParams.get("variant");
  const asset = await prisma.learningAsset.findFirst({
    where: {
      id: assetId,
      organizationId: session.organizationId,
      OR: [
        {
          clinicId: null,
        },
        {
          clinicId: {
            in: allowedClinicIds(session),
          },
        },
      ],
      storageProvider: {
        in: ["local", "r2"],
      },
    },
    select: {
      fileName: true,
      mimeType: true,
      previewMimeType: true,
      previewStorageKey: true,
      thumbnailMimeType: true,
      thumbnailStorageKey: true,
      storageProvider: true,
      storageKey: true,
      title: true,
    },
  });

  if (!asset?.storageKey) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const variantStorageKey =
      variant === "preview"
        ? asset.previewStorageKey
        : variant === "thumbnail"
          ? asset.thumbnailStorageKey
          : null;
    const variantMimeType =
      variant === "preview"
        ? asset.previewMimeType
        : variant === "thumbnail"
          ? asset.thumbnailMimeType
          : null;
    const bytes = await readStoredPatientFile({
      storageProvider: asset.storageProvider,
      storageKey: variantStorageKey ?? asset.storageKey,
      sourceId: variantStorageKey ?? asset.storageKey,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeRFC5987(
          asset.fileName ?? asset.title,
        )}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": variantMimeType ?? asset.mimeType ?? "application/octet-stream",
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
  return encodeURIComponent(value).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
}

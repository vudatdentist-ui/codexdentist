import { readStoredPatientFile } from "@/lib/patient-file-storage";
import { requireViewSession } from "@/lib/auth";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const session = await requireViewSession("accounting");
  const { entryId } = await params;
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant");
  const entry = await prisma.accountingEntry.findFirst({
    where: {
      id: decodeURIComponent(entryId),
      organizationId: session.organizationId,
      OR: accountingAttachmentScope(session),
    },
    select: {
      attachmentFileName: true,
      attachmentMimeType: true,
      attachmentStorageKey: true,
      attachmentStorageProvider: true,
      attachmentThumbnailMimeType: true,
      attachmentThumbnailStorageKey: true,
      description: true,
    },
  });

  if (!entry?.attachmentStorageKey) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const variantStorageKey =
      variant === "thumbnail" ? entry.attachmentThumbnailStorageKey : null;
    const variantMimeType =
      variant === "thumbnail" ? entry.attachmentThumbnailMimeType : null;
    const bytes = await readStoredPatientFile({
      storageProvider: entry.attachmentStorageProvider,
      storageKey: variantStorageKey ?? entry.attachmentStorageKey,
      sourceId: variantStorageKey ?? entry.attachmentStorageKey,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeRFC5987(
          entry.attachmentFileName ?? `${entry.description}-attachment`,
        )}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": variantMimeType ?? entry.attachmentMimeType ?? "image/jpeg",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function accountingAttachmentScope(session: AppSession) {
  if (canUseAllClinics(session)) {
    return [
      {
        clinicId: {
          in: session.clinicIds,
        },
      },
      {
        clinicId: null,
      },
    ];
  }

  return [
    {
      clinicId: {
        in: session.activeClinicId ? [session.activeClinicId] : session.clinicIds,
      },
    },
    {
      clinicId: null,
    },
  ];
}

function encodeRFC5987(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}

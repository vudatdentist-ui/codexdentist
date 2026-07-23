import { requireSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { readStoredPatientFile } from "@/lib/patient-file-storage";
import { getAuthorizedPatientFile } from "@/lib/resource-policy";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ fileId: string }>;
  },
) {
  const session = await requireSession();

  const { fileId } = await params;
  const variant = new URL(request.url).searchParams.get("variant");
  const file = await getAuthorizedPatientFile(session, fileId);

  if (!file?.sourceId) {
    return new Response("Not found", { status: 404 });
  }

  if (file.blocked) {
    await writeAuditLog({
      session,
      organizationId: file.organizationId,
      action: "patient_file.blocked",
      entityType: "PatientFile",
      entityId: file.id,
      metadata: {
        clinicId: file.clinicId,
        patientId: file.patientId,
        virusScanStatus: file.virusScanStatus,
        variant: variant ?? "original",
      },
    });

    return new Response("File is not cleared for access.", { status: 423 });
  }

  try {
    const variantStorageKey =
      variant === "preview"
        ? file.previewStorageKey
        : variant === "thumbnail"
          ? file.thumbnailStorageKey
          : null;
    const variantMimeType =
      variant === "preview"
        ? file.previewMimeType
        : variant === "thumbnail"
          ? file.thumbnailMimeType
          : null;
    const bytes = await readStoredPatientFile({
      storageProvider: file.storageProvider,
      storageKey: variantStorageKey ?? file.storageKey,
      sourceId: variantStorageKey ?? file.sourceId,
    });
    await writeAuditLog({
      session,
      organizationId: file.organizationId,
      action: "patient_file.viewed",
      entityType: "PatientFile",
      entityId: file.id,
      metadata: {
        clinicId: file.clinicId,
        patientId: file.patientId,
        variant: variant ?? "original",
        virusScanStatus: file.virusScanStatus,
      },
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${contentDispositionFor(
          variantMimeType ?? file.mimeType,
        )}; filename*=UTF-8''${encodeRFC5987(file.fileName ?? file.title)}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": variantMimeType ?? file.mimeType ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function contentDispositionFor(mimeType?: string | null) {
  return mimeType?.startsWith("image/") || mimeType === "application/pdf"
    ? "inline"
    : "attachment";
}

function encodeRFC5987(value: string) {
  return encodeURIComponent(value).replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
}

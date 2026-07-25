import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import {
  patientFileStorageDriver,
  patientFileStorageRoot,
  r2StorageConfig,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";

const MB = 1024 * 1024;

export const PATIENT_FILE_SIZE_LIMITS = {
  document: 25 * MB,
  image: 15 * MB,
  model3d: 100 * MB,
  pdf: 50 * MB,
  video: 100 * MB,
} as const;
export const MAX_PATIENT_FILE_BYTES = Math.max(
  ...Object.values(PATIENT_FILE_SIZE_LIMITS),
);

export type PatientFileKind =
  | "document"
  | "image"
  | "model3d"
  | "pdf"
  | "unsupported"
  | "video";

const extensionByMimeType: Record<string, string> = {
  "application/3mf": ".3mf",
  "application/msword": ".doc",
  "application/octet-stream": "",
  "application/pdf": ".pdf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "model/gltf-binary": ".glb",
  "model/gltf+json": ".gltf",
  "model/obj": ".obj",
  "model/stl": ".stl",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};
const allowedImageMimeTypes = new Set([
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const imageMimeTypesWithVariants = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const documentExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const model3dExtensions = new Set([".3mf", ".glb", ".gltf", ".obj", ".ply", ".stl", ".zip"]);
const videoExtensions = new Set([".mov", ".mp4"]);
let r2Client: S3Client | null = null;

export type StoredPatientUploadVariant = {
  mimeType: string;
  relativePath: string;
  sizeBytes: number;
  storageKey: string;
};

export type StoredPatientUpload = {
  fileName: string;
  fileKind: Exclude<PatientFileKind, "unsupported">;
  mimeType: string;
  preview?: StoredPatientUploadVariant;
  relativePath: string;
  sizeBytes: number;
  storageProvider: "local" | "r2";
  storageKey: string;
  thumbnail?: StoredPatientUploadVariant;
  checksumSha256: string;
};

export function isUploadedPatientFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    typeof (value as File).name === "string" &&
    typeof (value as File).size === "number" &&
    (value as File).size > 0
  );
}

export function isSupportedPatientFileMimeType(mimeType: string) {
  return classifyPatientFile({ mimeType }).kind !== "unsupported";
}

export function isSupportedPatientFile(file: File) {
  return classifyPatientFile({ fileName: file.name, mimeType: file.type }).kind !== "unsupported";
}

export function patientFileSizeLimitBytes(file: File) {
  const { kind } = classifyPatientFile({ fileName: file.name, mimeType: file.type });

  return kind === "unsupported" ? 0 : PATIENT_FILE_SIZE_LIMITS[kind];
}

export function patientFileValidationError(file: File) {
  if (!isSupportedPatientFile(file)) {
    return "files-unsupported" as const;
  }

  if (file.size > patientFileSizeLimitBytes(file)) {
    return "files-too-large" as const;
  }

  return null;
}

export function classifyPatientFile(input: {
  fileName?: string | null;
  mimeType?: string | null;
}): { extension: string; kind: PatientFileKind } {
  const mimeType = (input.mimeType ?? "").toLowerCase();
  const extension = extensionFromName(input.fileName ?? "");

  if (allowedImageMimeTypes.has(mimeType)) {
    return { extension, kind: "image" };
  }

  if (mimeType === "application/pdf" || extension === ".pdf") {
    return { extension, kind: "pdf" };
  }

  if (mimeType.startsWith("video/") || videoExtensions.has(extension)) {
    return { extension, kind: "video" };
  }

  if (mimeType.startsWith("model/") || model3dExtensions.has(extension)) {
    return { extension, kind: "model3d" };
  }

  if (
    documentExtensions.has(extension) ||
    mimeType.startsWith("application/vnd.openxmlformats-officedocument.") ||
    mimeType === "application/msword"
  ) {
    return { extension, kind: "document" };
  }

  return { extension, kind: "unsupported" };
}

export async function storePatientUpload({
  file,
  organizationId,
  patientId,
  patientFileId,
}: {
  file: File;
  organizationId: string;
  patientId: string;
  patientFileId: string;
}): Promise<StoredPatientUpload> {
  return storeUpload({
    file,
    organizationId,
    ownerId: patientId,
    storageFileId: patientFileId,
    storageNamespace: "patient-files",
    fallbackFileName: "patient-file",
  });
}

export async function storeLearningUpload({
  file,
  organizationId,
  contentId,
  assetId,
}: {
  file: File;
  organizationId: string;
  contentId: string;
  assetId: string;
}): Promise<StoredPatientUpload> {
  return storeUpload({
    file,
    organizationId,
    ownerId: contentId,
    storageFileId: assetId,
    storageNamespace: "learning-assets",
    fallbackFileName: "learning-asset",
  });
}

export async function storeStaffProfileUpload({
  file,
  organizationId,
  userId,
}: {
  file: File;
  organizationId: string;
  userId: string;
}): Promise<StoredPatientUpload> {
  return storeUpload({
    file,
    organizationId,
    ownerId: userId,
    storageFileId: userId,
    storageNamespace: "staff-profile",
    fallbackFileName: "staff-profile",
  });
}

export async function storeAccountingUpload({
  file,
  organizationId,
  entryId,
}: {
  file: File;
  organizationId: string;
  entryId: string;
}): Promise<StoredPatientUpload> {
  return storeUpload({
    file,
    organizationId,
    ownerId: entryId,
    storageFileId: entryId,
    storageNamespace: "accounting-attachments",
    fallbackFileName: "accounting-attachment",
  });
}

async function storeUpload({
  file,
  organizationId,
  ownerId,
  storageFileId,
  storageNamespace,
  fallbackFileName,
}: {
  file: File;
  organizationId: string;
  ownerId: string;
  storageFileId: string;
  storageNamespace: "patient-files" | "learning-assets" | "staff-profile" | "accounting-attachments";
  fallbackFileName: string;
}): Promise<StoredPatientUpload> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true },
  });

  if (organization?.isDemo) {
    throw new Error("File uploads are disabled in demo workspaces.");
  }

  const storageProvider = patientFileStorageDriver();
  const originalName = sanitizeFileName(file.name || fallbackFileName);
  const mimeType = (file.type || "application/octet-stream").toLowerCase();
  const { kind: fileKind } = classifyPatientFile({
    fileName: originalName,
    mimeType,
  });

  if (fileKind === "unsupported") {
    throw new Error("Unsupported file type");
  }

  if (file.size > PATIENT_FILE_SIZE_LIMITS[fileKind]) {
    throw new Error("File exceeds the allowed size");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  validateUploadContent({
    bytes,
    fileKind,
    fileName: originalName,
    mimeType,
  });

  const extension = extensionFor(originalName, mimeType);
  const safeOrganizationId = sanitizePathSegment(organizationId);
  const safeOwnerId = sanitizePathSegment(ownerId);
  const storageName = `${storageFileId}-${randomUUID()}${extension}`;
  const storageKey = objectKey(
    storageNamespace,
    safeOrganizationId,
    safeOwnerId,
    storageName,
  );
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const variants = await createImageVariants({
    bytes,
    mimeType,
    fileId: storageFileId,
    storageNamespace,
    safeOrganizationId,
    safeOwnerId,
    storageProvider,
  });

  if (storageProvider === "r2") {
    await storeR2Object({
      key: storageKey,
      bytes,
      mimeType,
      fileName: originalName,
      checksumSha256,
    });

    return {
      fileName: originalName,
      fileKind,
      mimeType,
      preview: variants.preview,
      relativePath: storageKey,
      sizeBytes: file.size,
      storageProvider,
      storageKey,
      thumbnail: variants.thumbnail,
      checksumSha256,
    };
  }

  await storeLocalObject(storageKey, bytes);

  return {
    fileName: originalName,
    fileKind,
    mimeType,
    preview: variants.preview,
    relativePath: storageKey,
    sizeBytes: file.size,
    storageProvider,
    storageKey,
    thumbnail: variants.thumbnail,
    checksumSha256,
  };
}

export async function readStoredPatientFile(input: {
  storageProvider?: string | null;
  storageKey?: string | null;
  sourceId?: string | null;
}) {
  const provider = input.storageProvider ?? "local";
  const key = input.storageKey ?? input.sourceId;

  if (!key) {
    throw new Error("Missing patient file storage key");
  }

  if (provider === "r2") {
    return readR2Object(key);
  }

  if (provider !== "local") {
    throw new Error(`Unsupported patient file storage provider: ${provider}`);
  }

  return readLocalObject(key);
}

async function resolveStoredPatientFilePath(relativePath: string) {
  const path = await import("node:path");
  const normalized = relativePath.replaceAll("\\", "/");
  const storageRelativePath = normalized.replace(/^patient-files\//, "");
  const root = await localStorageRoot();
  const absolutePath = path.resolve(root, storageRelativePath);

  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid patient file path");
  }

  return absolutePath;
}

function extensionFor(fileName: string, mimeType: string) {
  const mapped = extensionByMimeType[mimeType];

  if (mapped) {
    return mapped;
  }

  const parsed = extensionFromName(fileName);

  if (/^\.[a-z0-9]{1,8}$/.test(parsed)) {
    return parsed;
  }

  return extensionByMimeType[mimeType] ?? "";
}

function validateUploadContent(input: {
  bytes: Buffer;
  fileKind: Exclude<PatientFileKind, "unsupported">;
  fileName: string;
  mimeType: string;
}) {
  if (input.bytes.length === 0) {
    throw new Error("Empty file");
  }

  const leadingText = input.bytes
    .subarray(0, Math.min(input.bytes.length, 512))
    .toString("utf8")
    .trimStart()
    .toLowerCase();

  if (
    leadingText.startsWith("<svg") ||
    leadingText.startsWith("<!doctype html") ||
    leadingText.startsWith("<html") ||
    leadingText.startsWith("<script")
  ) {
    throw new Error("Active web content is not allowed");
  }

  if (input.fileKind === "image") {
    const detectedMimeType = detectImageMimeType(input.bytes);

    if (!detectedMimeType || detectedMimeType !== input.mimeType) {
      throw new Error("Image content does not match its declared type");
    }

    return;
  }

  if (
    input.fileKind === "pdf" &&
    !input.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  ) {
    throw new Error("Invalid PDF signature");
  }

  if (input.fileKind === "video" && !hasIsoBaseMediaSignature(input.bytes)) {
    throw new Error("Invalid video signature");
  }

  if (input.fileKind === "document") {
    const extension = extensionFromName(input.fileName);
    const isOpenXml = [".docx", ".pptx", ".xlsx"].includes(extension);
    const isLegacyOffice = [".doc", ".ppt", ".xls"].includes(extension);

    if (isOpenXml && !hasZipSignature(input.bytes)) {
      throw new Error("Invalid Open XML document signature");
    }

    if (isLegacyOffice && !hasOleCompoundSignature(input.bytes)) {
      throw new Error("Invalid legacy Office document signature");
    }
  }
}

function detectImageMimeType(bytes: Buffer) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }

  const gifHeader = bytes.subarray(0, 6).toString("ascii");

  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  if (hasIsoBaseMediaSignature(bytes)) {
    const brand = bytes.subarray(8, 12).toString("ascii").toLowerCase();

    if (
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)
    ) {
      return "image/heic";
    }
  }

  return null;
}

function hasIsoBaseMediaSignature(bytes: Buffer) {
  return (
    bytes.length >= 12 &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp"
  );
}

function hasZipSignature(bytes: Buffer) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
    [0x04, 0x06, 0x08].includes(bytes[3] ?? -1)
  );
}

function hasOleCompoundSignature(bytes: Buffer) {
  return (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  );
}

function extensionFromName(fileName: string) {
  return fileName.toLowerCase().match(/(\.[a-z0-9]{1,8})$/)?.[1] ?? "";
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName.normalize("NFKD").replace(/[^\w.\- ]+/g, "");
  const collapsed = normalized.trim().replace(/\s+/g, "-").slice(0, 120);

  return collapsed || "patient-file";
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function objectKey(...segments: string[]) {
  return segments
    .map((segment) => segment.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

async function storeLocalObject(storageKey: string, bytes: Buffer) {
  const path = await import("node:path");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const root = await localStorageRoot();
  const storageRelativePath = storageKey.replace(/^patient-files\//, "");
  const absolutePath = path.resolve(root, storageRelativePath);

  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid patient file path");
  }

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes, {
    flag: "wx",
  });
}

async function createImageVariants(input: {
  bytes: Buffer;
  mimeType: string;
  fileId: string;
  storageNamespace: "patient-files" | "learning-assets" | "staff-profile" | "accounting-attachments";
  safeOrganizationId: string;
  safeOwnerId: string;
  storageProvider: "local" | "r2";
}) {
  if (!imageMimeTypesWithVariants.has(input.mimeType)) {
    return {};
  }

  let sharp: any;

  try {
    const sharpPackageName = "sharp";
    const sharpModule = await import(sharpPackageName);
    sharp = sharpModule.default;
    sharp.block({
      operation: [
        "VipsForeignLoadNsgif",
        "VipsForeignLoadTiff",
        "VipsForeignLoadVips",
      ],
    });
  } catch {
    return {};
  }

  const [previewBytes, thumbnailBytes] = await Promise.all([
    sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        fit: "inside",
        height: 2000,
        withoutEnlargement: true,
        width: 2000,
      })
      .webp({ quality: 82 })
      .toBuffer(),
    sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        fit: "inside",
        height: 480,
        withoutEnlargement: true,
        width: 480,
      })
      .webp({ quality: 74 })
      .toBuffer(),
  ]);
  const previewKey = objectKey(
    input.storageNamespace,
    input.safeOrganizationId,
    input.safeOwnerId,
    `${input.fileId}-${randomUUID()}-preview.webp`,
  );
  const thumbnailKey = objectKey(
    input.storageNamespace,
    input.safeOrganizationId,
    input.safeOwnerId,
    `${input.fileId}-${randomUUID()}-thumbnail.webp`,
  );

  if (input.storageProvider === "r2") {
    await Promise.all([
      storeR2Object({
        key: previewKey,
        bytes: previewBytes,
        mimeType: "image/webp",
        fileName: `${input.fileId}-preview.webp`,
        checksumSha256: createHash("sha256").update(previewBytes).digest("hex"),
      }),
      storeR2Object({
        key: thumbnailKey,
        bytes: thumbnailBytes,
        mimeType: "image/webp",
        fileName: `${input.fileId}-thumbnail.webp`,
        checksumSha256: createHash("sha256").update(thumbnailBytes).digest("hex"),
      }),
    ]);
  } else {
    await Promise.all([
      storeLocalObject(previewKey, previewBytes),
      storeLocalObject(thumbnailKey, thumbnailBytes),
    ]);
  }

  return {
    preview: {
      mimeType: "image/webp",
      relativePath: previewKey,
      sizeBytes: previewBytes.byteLength,
      storageKey: previewKey,
    },
    thumbnail: {
      mimeType: "image/webp",
      relativePath: thumbnailKey,
      sizeBytes: thumbnailBytes.byteLength,
      storageKey: thumbnailKey,
    },
  };
}

async function readLocalObject(storageKey: string) {
  const { readFile } = await import("node:fs/promises");

  return readFile(await resolveStoredPatientFilePath(storageKey));
}

async function localStorageRoot() {
  const path = await import("node:path");
  const configuredStorageRoot = patientFileStorageRoot();

  return configuredStorageRoot
    ? path.resolve(configuredStorageRoot)
    : path.join(process.cwd(), "storage", "patient-files");
}

async function storeR2Object(input: {
  key: string;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  checksumSha256: string;
}) {
  const config = requiredR2Config();

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.bytes,
      ContentType: input.mimeType,
      Metadata: {
        originalName: input.fileName,
        checksumSha256: input.checksumSha256,
      },
    }),
  );
}

async function readR2Object(key: string) {
  const config = requiredR2Config();
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Empty R2 object body");
  }

  return Buffer.from(await response.Body.transformToByteArray());
}

function getR2Client() {
  if (r2Client) {
    return r2Client;
  }

  const config = requiredR2Config();
  r2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return r2Client;
}

function requiredR2Config() {
  const config = r2StorageConfig();

  if (!config) {
    throw new Error("R2 storage is not configured.");
  }

  return config;
}

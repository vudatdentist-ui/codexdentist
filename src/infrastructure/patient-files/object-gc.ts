import "server-only";

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  patientFileStorageDriver,
  patientFileStorageRoot,
  r2StorageConfig,
} from "@/lib/env";
import type { PatientFileStageRow } from "@/infrastructure/patient-files/staging";

let r2Client: S3Client | null = null;

export function currentPatientFileStorageProvider(): "local" | "r2" {
  return patientFileStorageDriver();
}

export function patientFileStageStoragePrefix(input: {
  organizationId: string;
  patientId: string;
  patientFileId: string;
}) {
  return `patient-files/${safeSegment(input.organizationId)}/${safeSegment(input.patientId)}/${safeSegment(input.patientFileId)}-`;
}

export async function deletePatientFileStageObjects(
  stage: Pick<
    PatientFileStageRow,
    | "storageProvider"
    | "storageKey"
    | "previewStorageKey"
    | "thumbnailStorageKey"
  >,
) {
  const exactKeys = [
    stage.storageKey,
    stage.previewStorageKey,
    stage.thumbnailStorageKey,
  ].filter((value): value is string => Boolean(value));
  const prefixMode = stage.storageKey.endsWith("-");

  if (stage.storageProvider === "local") {
    if (prefixMode) {
      await deleteLocalPrefix(stage.storageKey);
      return;
    }
    await Promise.all(exactKeys.map((key) => deleteLocalObject(key)));
    return;
  }

  if (stage.storageProvider === "r2") {
    if (prefixMode) {
      await deleteR2Prefix(stage.storageKey);
      return;
    }
    await Promise.all(exactKeys.map((key) => deleteR2Object(key)));
    return;
  }

  throw new Error("patient-file-stage-storage-provider-unsupported");
}

async function deleteLocalPrefix(storagePrefix: string) {
  const path = await import("node:path");
  const { readdir, unlink } = await import("node:fs/promises");
  const prefixPath = await resolveLocalStoragePath(storagePrefix);
  const directory = path.dirname(prefixPath);
  const filePrefix = path.basename(prefixPath);
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(filePrefix))
      .map((entry) => unlink(path.join(directory, entry)).catch(ignoreMissingFile)),
  );
}

async function deleteLocalObject(storageKey: string) {
  const { unlink } = await import("node:fs/promises");
  await unlink(await resolveLocalStoragePath(storageKey)).catch(ignoreMissingFile);
}

async function resolveLocalStoragePath(storageKey: string) {
  const path = await import("node:path");
  const root = await localStorageRoot();
  const normalized = storageKey.replaceAll("\\", "/");
  const relativePath = normalized.replace(/^patient-files\//, "");
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("patient-file-stage-invalid-storage-path");
  }
  return absolutePath;
}

async function localStorageRoot() {
  const path = await import("node:path");
  const configured = patientFileStorageRoot();
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "storage", "patient-files");
}

async function deleteR2Prefix(prefix: string) {
  const config = requiredR2Config();
  let continuationToken: string | undefined;
  do {
    const response = await getR2Client().send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    await Promise.all(
      (response.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key))
        .map((key) => deleteR2Object(key)),
    );
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

async function deleteR2Object(key: string) {
  const config = requiredR2Config();
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}

function getR2Client() {
  if (r2Client) return r2Client;
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
  if (!config) throw new Error("patient-file-stage-r2-not-configured");
  return config;
}

function ignoreMissingFile(error: NodeJS.ErrnoException) {
  if (error.code !== "ENOENT") throw error;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

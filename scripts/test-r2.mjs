import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

loadDotEnv();

const accountId = env("R2_ACCOUNT_ID");
const endpoint =
  env("R2_ENDPOINT") ||
  (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
const bucket = env("R2_BUCKET_NAME");
const accessKeyId = env("R2_ACCESS_KEY_ID");
const secretAccessKey = env("R2_SECRET_ACCESS_KEY");

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing R2 env. Set R2_ACCOUNT_ID or R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.",
  );
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});
const body = `nhavista-r2-test-${new Date().toISOString()}-${randomBytes(8).toString("hex")}`;
const key = `self-host-tests/${Date.now()}-${randomBytes(4).toString("hex")}.txt`;

await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "text/plain; charset=utf-8",
  }),
);

const response = await client.send(
  new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }),
);
const downloaded = Buffer.from(await response.Body.transformToByteArray()).toString("utf8");

if (downloaded !== body) {
  throw new Error("R2 readback did not match uploaded object.");
}

console.log(`R2 ok: s3://${bucket}/${key}`);

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function loadDotEnv() {
  if (!existsSync(".env")) {
    return;
  }

  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

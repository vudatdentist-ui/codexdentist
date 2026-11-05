import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { authSecret } from "@/lib/env";

export type IntegrationSecretScope = { organizationId: string; connectionId: string; provider: string };
export type SqlExecutor = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;
const namespace = "codexdentist/integration-credentials/v1";
const maxPlaintextBytes = 32768;
const maxEnvelopeBytes = 45000;
const invalid = () => new Error("integration-secrets-invalid");

function associatedData(scope: IntegrationSecretScope) {
  try {
    const fields = [scope.organizationId, scope.connectionId, scope.provider];
    if (fields.some((value, index) => typeof value !== "string" || !value || value.includes("\0") ||
        Buffer.byteLength(value, "utf8") > (index === 2 ? 64 : 256))) throw invalid();
    return Buffer.from(JSON.stringify([namespace, ...fields]), "utf8");
  } catch { throw invalid(); }
}

function plaintext(value: Record<string, string>) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) throw invalid();
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (entries.length > 32) throw invalid();
    for (const [name, field] of entries) {
      if (!name || Buffer.byteLength(name, "utf8") > 128 || ["__proto__", "prototype", "constructor"].includes(name) ||
          !field.enumerable || !("value" in field) || typeof field.value !== "string" ||
          Buffer.byteLength(field.value, "utf8") > 8192) throw invalid();
    }
    const encoded = Buffer.from(JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([name, field]) => [name, field.value]))), "utf8");
    if (encoded.length > maxPlaintextBytes) throw invalid();
    return encoded;
  } catch { throw invalid(); }
}

function encryptionKey() {
  let material: Buffer | undefined;
  try {
    const configured = process.env.INTEGRATION_SECRET_KEY;
    if (configured !== undefined) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(configured)) throw invalid();
      material = Buffer.from(configured, "base64");
      if (material.length !== 32 || material.toString("base64") !== configured) throw invalid();
    } else {
      material = Buffer.from(authSecret(), "utf8");
      if (!material.length) throw invalid();
    }
    return Buffer.from(hkdfSync("sha256", material, namespace, "credential-vault/aes-256-gcm", 32));
  } catch { throw new Error("integration-secrets-key-invalid"); }
  finally { material?.fill(0); }
}

export function sealIntegrationSecrets(scope: IntegrationSecretScope, value: Record<string, string>): string {
  const aad = associatedData(scope), key = encryptionKey();
  let encoded: Buffer | undefined;
  try {
    encoded = plaintext(value);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(encoded), cipher.final()]);
    return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  } catch { throw invalid(); }
  finally { key.fill(0); encoded?.fill(0); }
}

export function openIntegrationSecrets(scope: IntegrationSecretScope, ciphertext: string): Record<string, string> {
  const aad = associatedData(scope);
  let parts: Buffer[];
  try {
    if (typeof ciphertext !== "string" || ciphertext.length > maxEnvelopeBytes) throw invalid();
    const pieces = ciphertext.split(".");
    if (pieces.length !== 4 || pieces[0] !== "v1") throw invalid();
    parts = pieces.slice(1).map(piece => {
      if (!/^[A-Za-z0-9_-]+$/.test(piece)) throw invalid();
      const decoded = Buffer.from(piece, "base64url");
      if (decoded.toString("base64url") !== piece) throw invalid();
      return decoded;
    });
    if (parts[0]!.length !== 12 || parts[2]!.length !== 16 || !parts[1]!.length || parts[1]!.length > maxPlaintextBytes) throw invalid();
  } catch { throw invalid(); }
  const key = encryptionKey();
  let decoded: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parts[0]!, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(parts[2]!);
    decoded = Buffer.concat([decipher.update(parts[1]!), decipher.final()]);
    const text = decoded.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(decoded)) throw invalid();
    const value = JSON.parse(text) as Record<string, string>;
    plaintext(value).fill(0);
    return value;
  } catch { throw invalid(); }
  finally { key.fill(0); decoded?.fill(0); }
}

export async function writeIntegrationSecrets(db: SqlExecutor, scope: IntegrationSecretScope, value: Record<string, string>): Promise<void> {
  const ciphertext = sealIntegrationSecrets(scope, value);
  let rows: { id: string }[];
  try {
    rows = await db.$queryRawUnsafe<{ id: string }[]>(
      `WITH scoped AS (
         SELECT "id", "organizationId" FROM "IntegrationConnection"
         WHERE "id"=$1 AND "organizationId"=$2 AND "provider"=$3 FOR UPDATE
       ), saved AS (
         INSERT INTO "IntegrationCredential" ("connectionId","organizationId","ciphertext","createdAt","updatedAt")
         SELECT "id","organizationId",$4,CURRENT_TIMESTAMP AT TIME ZONE 'UTC',CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM scoped
         ON CONFLICT ("connectionId") DO UPDATE SET "ciphertext"=EXCLUDED."ciphertext", "updatedAt"=EXCLUDED."updatedAt"
         WHERE "IntegrationCredential"."organizationId"=EXCLUDED."organizationId"
         RETURNING "connectionId","organizationId"
       )
       UPDATE "IntegrationConnection" c SET "secretRef"='vault:v1', "updatedAt"=CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
       FROM saved s WHERE c."id"=s."connectionId" AND c."organizationId"=s."organizationId" AND c."provider"=$3 RETURNING c."id"`,
      scope.connectionId, scope.organizationId, scope.provider, ciphertext,
    );
  } catch { throw new Error("integration-secrets-storage-unavailable"); }
  if (rows.length !== 1) throw new Error("integration-connection-not-found");
}

export async function readIntegrationSecrets(db: SqlExecutor, scope: IntegrationSecretScope): Promise<Record<string, string> | null> {
  associatedData(scope);
  let rows: { ciphertext: string | null; secretRef: string | null }[];
  try {
    rows = await db.$queryRawUnsafe<{ ciphertext: string | null; secretRef: string | null }[]>(
      `SELECT s."ciphertext", c."secretRef" FROM "IntegrationConnection" c
       LEFT JOIN "IntegrationCredential" s ON s."connectionId"=c."id" AND s."organizationId"=c."organizationId"
       WHERE c."id"=$1 AND c."organizationId"=$2 AND c."provider"=$3 LIMIT 1`,
      scope.connectionId, scope.organizationId, scope.provider,
    );
  } catch { throw new Error("integration-secrets-storage-unavailable"); }
  if (rows.length !== 1) throw new Error("integration-connection-not-found");
  if (rows[0]!.ciphertext === null) {
    if (rows[0]!.secretRef === "vault:v1") throw new Error("integration-secrets-missing");
    return null;
  }
  return openIntegrationSecrets(scope, rows[0]!.ciphertext);
}

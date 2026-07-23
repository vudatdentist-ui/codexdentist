import fs from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const write = process.argv.includes("--write");
const ownerEmail = (process.env.BLANK_OWNER_EMAIL || "").trim().toLowerCase();
const ownerPassword = process.env.BLANK_OWNER_PASSWORD || "";
const ownerName = process.env.BLANK_OWNER_NAME || "System Owner";
const organizationName = process.env.BLANK_ORGANIZATION_NAME || "CodexMed OS";
const organizationSlug = (process.env.BLANK_ORGANIZATION_SLUG || "codexmed").trim().toLowerCase();
const rootDomain = (process.env.APP_ROOT_DOMAIN || "codexdentist.com").trim().toLowerCase();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const iterations = 310000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

async function setEnvValue(name, value) {
  const envPath = ".env";
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${name}="${value}"`;
  const next = raw.match(new RegExp(`^${name}=`, "m"))
    ? raw.replace(new RegExp(`^${name}=.*$`, "m"), line)
    : `${raw.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, next, "utf8");
}

async function tableCounts() {
  const rows = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename ASC
  `;

  const entries = [];
  for (const row of rows) {
    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${row.tablename}"`,
    );
    entries.push([row.tablename, countRows[0]?.count ?? 0]);
  }
  return Object.fromEntries(entries);
}

try {
  const before = await tableCounts();
  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", before }, null, 2));

  if (!write) {
    process.exit(0);
  }

  if (!ownerEmail || !ownerEmail.includes("@")) {
    throw new Error("BLANK_OWNER_EMAIL is required when using --write.");
  }

  if (ownerPassword.length < 12) {
    throw new Error("BLANK_OWNER_PASSWORD must contain at least 12 characters.");
  }

  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename ASC
  `;
  const tableSql = tables.map((row) => `"${row.tablename}"`).join(", ");

  if (tableSql) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableSql} RESTART IDENTITY CASCADE`);
  }

  const organization = await prisma.organization.create({
    data: {
      name: organizationName,
      legalName: organizationName,
      slug: organizationSlug,
      primaryDomain: `${organizationSlug}.${rootDomain}`,
      locale: "vi-VN",
    },
    select: {
      id: true,
    },
  });

  const owner = await prisma.user.create({
    data: {
      organizationId: organization.id,
      email: ownerEmail,
      fullName: ownerName,
      role: "OWNER",
      active: true,
      passwordHash: hashPassword(ownerPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  await setEnvValue("DEMO_AUTH_ENABLED", "false");
  await setEnvValue("DEFAULT_DATA_SEED_ENABLED", "false");

  const after = await tableCounts();
  console.log(JSON.stringify({ mode: "write", owner, organizationId: organization.id, after }, null, 2));
} finally {
  await prisma.$disconnect();
}

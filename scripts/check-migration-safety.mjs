import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseSha = (process.env.MIGRATION_BASE_SHA ?? "").trim();

if (!baseSha || /^0+$/.test(baseSha)) {
  console.log("Migration safety: no comparison base; nothing to check.");
  process.exit(0);
}

let changedFiles = [];

try {
  changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", `${baseSha}..HEAD`, "--", "prisma/migrations"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.endsWith("/migration.sql"));
} catch (error) {
  console.error("Migration safety: unable to compare migrations against base SHA.");
  throw error;
}

if (changedFiles.length === 0) {
  console.log("Migration safety: no changed migration.sql files.");
  process.exit(0);
}

const forbiddenPatterns = [
  ["DROP TABLE", /\bDROP\s+TABLE\b/i],
  ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
  ["DROP TYPE", /\bDROP\s+TYPE\b/i],
  ["DROP SCHEMA", /\bDROP\s+SCHEMA\b/i],
  ["DROP VIEW", /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/i],
  ["DROP SEQUENCE", /\bDROP\s+SEQUENCE\b/i],
  ["DROP INDEX", /\bDROP\s+INDEX\b/i],
  ["DROP CONSTRAINT", /\bDROP\s+CONSTRAINT\b/i],
  ["TRUNCATE", /\bTRUNCATE\b/i],
  ["RENAME TABLE", /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/i],
  ["RENAME COLUMN", /\bRENAME\s+COLUMN\b/i],
  ["ALTER TYPE RENAME", /\bALTER\s+TYPE\b[\s\S]*?\bRENAME\b/i],
  ["ALTER COLUMN TYPE", /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i],
  ["ALTER COLUMN SET NOT NULL", /\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i],
  ["ALTER COLUMN DROP DEFAULT", /\bALTER\s+COLUMN\b[\s\S]*?\bDROP\s+DEFAULT\b/i],
  ["ADD REQUIRED COLUMN", /\bADD\s+(?:COLUMN\s+)?(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+[\s\S]*?\bNOT\s+NULL\b/i],
];

const violations = [];

for (const file of changedFiles) {
  const sql = stripSqlComments(readFileSync(file, "utf8"));
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(statement)) {
        violations.push(`${file}: ${label}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\nUnsafe production migration detected.");
  console.error(
    "Automatic production deploys require expand/contract migrations that remain compatible with the previous application release.",
  );
  for (const violation of violations) {
    console.error(` - ${violation}`);
  }
  console.error(
    "Use an expand migration first (nullable/additive schema), deploy compatible code, backfill separately, then contract in a later maintenance migration after rollback compatibility is no longer required.",
  );
  process.exit(1);
}

console.log(
  `Migration safety: ${changedFiles.length} changed migration file(s) are backward-compatible with automatic rollback.`,
);

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

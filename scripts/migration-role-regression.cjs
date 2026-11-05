// Run as an existing SUPERUSER against loopback test PostgreSQL. Creates and
// removes only its own random databases/role; never migrates the caller's DB.
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const source = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "test" || !source ||
    !["postgres:", "postgresql:"].includes(source.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) ||
    [...source.searchParams.keys()].some(key => /^(host|hostaddr|port|database|dbname|service|user|password|connectionstring)$/i.test(key))) {
  throw new Error("Migration role regression requires NODE_ENV=test and an explicit loopback admin DATABASE_URL.");
}
const sourceRoot = path.resolve(process.env.MIGRATION_ROLE_SOURCE_ROOT || path.join(__dirname, ".."));
const sql = fs.readFileSync(path.join(sourceRoot, "prisma/migrations/20260908090000_imaging_studies/migration.sql"), "utf8");
const boundary = sql.indexOf('ALTER TABLE "ImagingStudy"');
assert.ok(boundary > 0);
assert.equal((sql.match(/ALTER TABLE/g) || []).length, 1);
const prefix = sql.slice(0, boundary), remaining = sql.slice(boundary);
const indexes = [...prefix.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map(match => match[1]);
assert.equal(indexes.length, 4);
const core = ["Organization", "Clinic", "Patient", "User"];
const suffix = randomBytes(8).toString("hex");
const role = `migration_runtime_${suffix}`;
const password = randomBytes(24).toString("hex");
const databases = [], clients = [];
let admin, adminName, roleCreated = false;
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const relation = name => `public.${quote(name)}`;

async function connect(database, runtime = false) {
  const target = new URL(source);
  if (database) target.pathname = "/" + database;
  if (runtime) { target.username = role; target.password = password; }
  const client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 5000, query_timeout: 15000 });
  clients.push(client);
  await client.connect();
  await client.query("SET statement_timeout='15s'");
  await client.query("SET lock_timeout='5s'");
  return client;
}
async function createDatabase(label) {
  const name = `migration_role_test_${suffix}_${label}`;
  assert.match(name, /^migration_role_test_[a-f0-9]{16}_(partial|fresh)$/);
  await admin.query(`CREATE DATABASE ${quote(name)}`);
  databases.push(name);
  await admin.query(`REVOKE ALL ON DATABASE ${quote(name)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${quote(name)} TO ${quote(role)}`);
  const dbAdmin = await connect(name);
  await dbAdmin.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
  await dbAdmin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quote(role)}`);
  for (const table of core) {
    await dbAdmin.query(`CREATE TABLE ${relation(table)} (id TEXT PRIMARY KEY)`);
    await dbAdmin.query(`INSERT INTO ${relation(table)} (id) VALUES ($1)`, [table.toLowerCase()]);
    await dbAdmin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${relation(table)} TO ${quote(role)}`);
    const owner = await dbAdmin.query("SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename=$1", [table]);
    assert.equal(owner.rows[0].tableowner, adminName);
  }
  const runtime = await connect(name, true);
  await assertRuntime(runtime);
  return { dbAdmin, runtime };
}
async function assertRuntime(runtime) {
  const flags = await runtime.query(`SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole,
    rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname=current_user`);
  assert.deepEqual(flags.rows[0], { name: role, rolsuper: false, rolcreatedb: false,
    rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false });
  const schema = await runtime.query("SELECT has_schema_privilege(current_user,'public','USAGE') AND has_schema_privilege(current_user,'public','CREATE') AS allowed");
  assert.equal(schema.rows[0].allowed, true);
  for (const table of core) {
    const privileges = await runtime.query(`SELECT has_table_privilege(current_user,$1,'REFERENCES') AS refs,
      has_table_privilege(current_user,$1,'SELECT') AND has_table_privilege(current_user,$1,'INSERT')
      AND has_table_privilege(current_user,$1,'UPDATE') AND has_table_privilege(current_user,$1,'DELETE') AS crud`, [relation(table)]);
    assert.deepEqual(privileges.rows[0], { refs: false, crud: true });
  }
}
async function assertArtifact(client, ownerName, foreignKeys) {
  const artifact = await client.query('SELECT count(*)::int AS count FROM "ImagingStudy"');
  assert.equal(artifact.rows[0].count, 0);
  const owner = await client.query("SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='ImagingStudy'");
  assert.equal(owner.rows[0].tableowner, ownerName);
  const present = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='ImagingStudy' ORDER BY indexname");
  assert.deepEqual(present.rows.map(row => row.indexname), [...indexes, "ImagingStudy_pkey"].sort());
  const constraints = await client.query(`SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid='public."ImagingStudy"'::regclass AND contype='f' ORDER BY conname`);
  assert.equal(constraints.rowCount, foreignKeys);
  if (foreignKeys) {
    assert.deepEqual(constraints.rows.map(row => row.conname), ["clinicId", "createdById", "organizationId", "patientId"].map(name => `ImagingStudy_${name}_fkey`).sort());
    assert.ok(constraints.rows.every(row => row.convalidated));
  }
}
async function runtimeCrud(runtime) {
  const insert = `INSERT INTO "ImagingStudy" (id,"organizationId","clinicId","patientId","connectionId",
    "externalStudyId",modalities,"createdById") VALUES ($1,$2,'clinic','patient','synthetic-connection',$1,ARRAY['CT'],'user')`;
  await assert.rejects(runtime.query(insert, ["invalid", "missing-organization"]), error => error.code === "23503");
  assert.equal((await runtime.query(insert, ["synthetic", "organization"])).rowCount, 1);
  assert.equal((await runtime.query('SELECT id FROM "ImagingStudy" WHERE id=$1', ["synthetic"])).rowCount, 1);
  assert.equal((await runtime.query('UPDATE "ImagingStudy" SET description=$1 WHERE id=$2', ["Synthetic update", "synthetic"])).rowCount, 1);
  assert.equal((await runtime.query('DELETE FROM "ImagingStudy" WHERE id=$1', ["synthetic"])).rowCount, 1);
  for (const table of core) {
    const retained = await runtime.query(`SELECT id FROM ${relation(table)}`);
    assert.deepEqual(retained.rows, [{ id: table.toLowerCase() }]);
  }
  await assertRuntime(runtime);
}
async function main() {
  admin = await connect();
  const identity = await admin.query("SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname=current_user");
  assert.equal(identity.rows[0].rolsuper, true, "Caller must be an existing test-cluster SUPERUSER.");
  adminName = identity.rows[0].name;
  assert.match(role, /^migration_runtime_[a-f0-9]{16}$/);
  await admin.query(`CREATE ROLE ${quote(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  roleCreated = true;

  const partial = await createDatabase("partial");
  await partial.runtime.query(prefix);
  await assert.rejects(partial.runtime.query(remaining), error => error.code === "42501" && /Organization/.test(error.message));
  await assertArtifact(partial.dbAdmin, role, 0);
  await assertRuntime(partial.runtime);
  console.log("ok exact imaging CREATE/index prefix survives runtime REFERENCES denial 42501 as an empty artifact");
  // Apply only the exact unfinished ALTER. Do not replay CREATE or elevate runtime.
  await partial.dbAdmin.query(remaining);
  await assertArtifact(partial.dbAdmin, role, 4);
  await runtimeCrud(partial.runtime);
  console.log("ok admin forward recovery adds all four validated foreign keys; unchanged runtime role has CRUD");

  const fresh = await createDatabase("fresh");
  await fresh.dbAdmin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(adminName)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quote(role)}`);
  await fresh.dbAdmin.query(sql);
  await assertArtifact(fresh.dbAdmin, adminName, 4);
  await runtimeCrud(fresh.runtime);
  console.log("ok fresh admin-owned imaging migration grants runtime CRUD via admin default privileges; core REFERENCES remains false");
}
async function cleanup() {
  const closed = await Promise.allSettled(clients.filter(client => client !== admin).map(client => client.end()));
  const errors = closed.filter(result => result.status === "rejected").map(result => result.reason);
  if (admin) {
    for (const name of [...databases].reverse()) {
      assert.match(name, /^migration_role_test_[a-f0-9]{16}_(partial|fresh)$/);
      assert.notEqual(name, decodeURIComponent(source.pathname.slice(1)));
      try { await admin.query(`DROP DATABASE ${quote(name)}`); } catch (error) { errors.push(error); }
    }
    if (roleCreated) {
      assert.match(role, /^migration_runtime_[a-f0-9]{16}$/);
      try { await admin.query(`DROP ROLE ${quote(role)}`); } catch (error) { errors.push(error); }
    }
    await admin.end();
  }
  if (errors.length) throw new AggregateError(errors, "Scoped migration-role cleanup failed.");
}
(async () => { try { await main(); } finally { await cleanup(); } })()
  .catch(error => { console.error(error); process.exitCode = 1; });

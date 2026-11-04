import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = require("./audit-source-loader.cjs");
const permissions = load("src/lib/permissions.ts");
const scope = load("src/lib/tenant-scope.ts", { "@/lib/permissions": permissions });
const session = {
  organizationId: "organization-a", userId: "staff-a", role: "DENTIST", roles: ["DENTIST"],
  roleAssignments: [{ organizationId: "organization-a", clinicId: "clinic-a", role: "DENTIST" }],
  clinicIds: ["clinic-a", "clinic-b"], activeClinicId: "clinic-a",
};
const mocks = {
  "@/lib/actions/permissions": { canPerformAction: () => true },
  "@/lib/patient-access": { allowedClinicIds: scope.accessibleClinicIds },
};
let query;
let updates = 0;
const labCase = { id: "lab-case-a", status: "SENT", sentAt: new Date("2026-11-01T00:00:00Z") };
const cycle = { id: "cycle-a", status: "RUNNING", startedAt: new Date("2026-11-01T00:00:00Z"), instruments: [{ instrumentId: "instrument-a" }] };
const db = {
  patient: { findMany: async input => { query = input; return []; } },
  labCase: { findFirst: async () => labCase, findUniqueOrThrow: async () => labCase, updateMany: async () => { updates++; } },
  sterilizationCycle: { findFirst: async () => cycle, findUniqueOrThrow: async () => cycle, updateMany: async () => { updates++; } },
  sterilizationInstrument: { findMany: async input => { query = input; return [{ id: "instrument-a", cycles: [{ cycleId: "cycle-a" }] }]; } },
  $transaction: async command => command(db),
};
const allowed = { ...mocks, "@/lib/prisma": { prisma: db } };
const lab = load("src/lib/application/lab/commands.ts", allowed);
const sterilization = load("src/lib/application/sterilization/commands.ts", allowed);
await lab.searchOperationPatientsCommand(session, { purpose: "lab", query: "Patient" });
assert.equal(query.where.organizationId, session.organizationId);
assert.deepEqual([...query.where.clinicId.in], ["clinic-a"]);
assert.deepEqual(Object.keys(query.select).sort(), ["clinic", "fullName", "id", "phone"]);
assert.equal(query.take, 50);
assert.equal(await lab.transitionLabCaseCommand(session, { id: labCase.id, status: "SENT" }), labCase);
assert.equal(await sterilization.transitionSterilizationCycleCommand(session, { id: cycle.id, status: "RUNNING" }), cycle);
assert.equal(updates, 0, "retrying an existing status must preserve its original timestamp");
await assert.rejects(lab.createLabCaseCommand(session, { patientId: "patient-a", title: "Crown", workType: "Crown", dueAt: "2026-02-30" }), error => error.code === "lab-due-date-invalid");
const instruments = await sterilization.listSterilizationInstrumentsCommand(session);
assert.equal(instruments[0].busy, true);
assert.deepEqual([...query.where.clinicId.in], ["clinic-a"]);
assert.deepEqual([...query.select.cycles.where.cycle.status.in], ["PREPARING", "RUNNING", "PASSED"]);
let touches = 0;
const forbiddenDb = new Proxy({}, { get() { touches++; throw new Error("unauthorized persistence access"); } });
const denied = { ...mocks, "@/lib/actions/permissions": { canPerformAction: () => false }, "@/lib/prisma": { prisma: forbiddenDb } };
for (const [file, calls] of [
  ["lab", [["createLabCaseCommand", {}], ["listLabCasesCommand"], ["transitionLabCaseCommand", {}], ["searchOperationPatientsCommand", { purpose: "imaging", query: "" }]]],
  ["sterilization", [["createSterilizationInstrumentCommand", {}], ["createSterilizationCycleCommand", {}], ["listSterilizationCyclesCommand"], ["listSterilizationInstrumentsCommand"], ["transitionSterilizationCycleCommand", {}]]],
]) {
  const commands = load(`src/lib/application/${file}/commands.ts`, denied);
  for (const [name, input] of calls) await assert.rejects(commands[name](session, input), error => error.code.endsWith("denied"));
}
assert.equal(touches, 0);
const responses = load("src/app/api/imaging/responses.ts", {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
}, { Headers });
const domain = load("src/domains/operations/lab.ts");
// Use the same domain module cache as the response mapper for instanceof checks.
const cache = new Map();
const sharedResponses = load("src/app/api/imaging/responses.ts", { "next/server": {} }, {}, cache);
const sharedDomain = load("src/domains/operations/lab.ts", {}, {}, cache);
try { sharedDomain.assertLabTransition("DELIVERED", "SENT"); assert.fail("terminal transition allowed"); }
catch (error) { assert.equal(sharedResponses.commandErrorCode(error, "fallback"), "lab-status-transition-invalid"); }
assert.equal(responses.noStoreJson({}, { headers: { "cache-control": "public" } }).headers.get("cache-control"), "no-store");
assert.equal(responses.commandErrorCode({ code: "P2002", message: "private data" }, "fallback"), "operation-unique-conflict");
assert.equal(domain.labNextStatuses("DELIVERED").length, 0);

// getSession deliberately leaves global owners without an active clinic.
const globalOwner = {
  ...session, role: "OWNER", roles: ["OWNER"], activeClinicId: null,
  roleAssignments: [{ organizationId: session.organizationId, clinicId: null, role: "OWNER" }],
};
const scopedStaff = {
  ...session, role: "HYGIENIST", roles: ["HYGIENIST"],
  roleAssignments: [{ organizationId: session.organizationId, clinicId: "clinic-a", role: "HYGIENIST" }],
};
let transactions = 0;
const creations = [];
const clinicInstruments = [
  { id: "instrument-a", organizationId: session.organizationId, clinicId: "clinic-a" },
  { id: "instrument-b", organizationId: session.organizationId, clinicId: "clinic-b" },
];
const creationDb = {
  $transaction: async command => { transactions++; return command(creationDb); },
  $executeRaw: async () => 1,
  sterilizationInstrument: {
    create: async ({ data }) => { creations.push(data); return data; },
    findMany: async ({ where }) => clinicInstruments.filter(item => where.id.in.includes(item.id) && item.organizationId === where.organizationId && item.clinicId === where.clinicId),
  },
  sterilizationCycleInstrument: { findFirst: async () => null },
  sterilizationCycle: { create: async ({ data }) => { creations.push(data); return data; } },
  auditLog: { create: async () => ({}) },
};
const clinicCommands = load("src/lib/application/sterilization/commands.ts", { ...mocks, "@/lib/prisma": { prisma: creationDb } });
const instrumentInput = { code: "QA", name: "Synthetic fixture", category: "QA" };
const cycleInput = { method: "Steam", instrumentIds: ["instrument-b"] };
const ownerInstrument = await clinicCommands.createSterilizationInstrumentCommand(globalOwner, { ...instrumentInput, clinicId: " clinic-b " });
assert.equal(ownerInstrument.clinicId, "clinic-b");
assert.equal(ownerInstrument.organizationId, session.organizationId);
const ownerCycle = await clinicCommands.createSterilizationCycleCommand(globalOwner, { ...cycleInput, clinicId: "clinic-b" });
assert.equal(ownerCycle.clinicId, "clinic-b");
assert.equal(ownerCycle.instruments.create[0].instrument.connect.id_organizationId_clinicId.clinicId, "clinic-b");
assert.equal(ownerCycle.instruments.create[0].clinic.connect.id_organizationId.organizationId, session.organizationId);
assert.equal((await clinicCommands.createSterilizationInstrumentCommand(scopedStaff, instrumentInput)).clinicId, "clinic-a");
assert.equal((await clinicCommands.createSterilizationCycleCommand(scopedStaff, { ...cycleInput, instrumentIds: ["instrument-a"] })).clinicId, "clinic-a");
assert.equal((await clinicCommands.createSterilizationInstrumentCommand({ ...globalOwner, clinicIds: ["clinic-a"] }, instrumentInput)).clinicId, "clinic-a");
const beforeDenials = transactions;
for (const [name, input] of [["createSterilizationInstrumentCommand", instrumentInput], ["createSterilizationCycleCommand", cycleInput]]) {
  await assert.rejects(clinicCommands[name](globalOwner, input), error => error.code === "sterilization-clinic-required");
  await assert.rejects(clinicCommands[name](globalOwner, { ...input, clinicId: "other-tenant-clinic" }), error => error.code === "sterilization-clinic-denied");
  await assert.rejects(clinicCommands[name](scopedStaff, { ...input, clinicId: "clinic-b" }), error => error.code === "sterilization-clinic-denied");
}
assert.equal(transactions, beforeDenials, "invalid or missing clinic selection must fail before persistence");
const beforeMixedLoad = creations.length;
await assert.rejects(clinicCommands.createSterilizationCycleCommand(globalOwner, { ...cycleInput, clinicId: "clinic-b", instrumentIds: ["instrument-a", "instrument-b"] }), error => error.code === "sterilization-instrument-scope-invalid");
assert.equal(creations.length, beforeMixedLoad, "an owner cannot mix instruments from two accessible clinics in one cycle");
for (const [route, input] of [["instruments", instrumentInput], ["cycles", cycleInput]]) {
  const api = load(`src/app/api/sterilization/${route}/route.ts`, {
    "@/lib/application/sterilization/commands": clinicCommands,
    "@/lib/auth": { getSession: async () => globalOwner },
    "@/lib/request-security": { hasSameOrigin: () => true },
    "@/app/api/imaging/responses": {
      noStoreJson: (body, init) => Response.json(body, init),
      apiError: (code, status) => Response.json({ error: code }, { status }),
      commandErrorCode: (cause, fallback) => cause?.code ?? fallback,
    },
  });
  const post = clinicId => api.POST(new Request(`http://127.0.0.1/api/sterilization/${route}`, { method: "POST", body: JSON.stringify({ ...input, clinicId }) }));
  assert.equal((await post("clinic-b")).status, 201);
  assert.equal((await post("other-tenant-clinic")).status, 403);
  assert.equal((await post(undefined)).status, 400);
  assert.equal((await post({ id: "clinic-b" })).status, 400);
}
console.log("ok phase5 operator contracts: scoped lookup, command denials, retry timestamps, validation, global-owner clinic selection, scoped-staff compatibility, cross-clinic denials and API forwarding");

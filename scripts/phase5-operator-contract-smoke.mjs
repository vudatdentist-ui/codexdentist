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
console.log("ok phase5 operator contracts: scoped lookup, 9 command denials, busy instruments, retry timestamps, calendar validation, domain errors, no-store responses");

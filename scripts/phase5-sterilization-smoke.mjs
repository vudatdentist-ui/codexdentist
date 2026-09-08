import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.ts";
import { assertSterilizationTransition, createSterilizationCycleCommand, createSterilizationInstrumentCommand, listSterilizationCyclesCommand, transitionSterilizationCycleCommand } from "../src/lib/application/sterilization/commands.ts";

const suffix = randomUUID();
const orgA = `phase5-stz-org-a-${suffix}`;
const orgB = `phase5-stz-org-b-${suffix}`;
const clinicA = `phase5-stz-clinic-a-${suffix}`;
const clinicB = `phase5-stz-clinic-b-${suffix}`;
const userA = `phase5-stz-user-a-${suffix}`;
const userB = `phase5-stz-user-b-${suffix}`;
const session = (organizationId, clinicId, userId) => ({ sessionId: `s-${userId}`, userId, email: `${userId}@example.test`, fullName: "Sterilization QA", role: "HYGIENIST", roles: ["HYGIENIST"], roleAssignments: [{ role: "HYGIENIST", organizationId, clinicId }], organizationId, organizationName: organizationId, organizationSlug: null, organizationDomain: null, isDemo: false, workspaceExpiresAt: null, clinicIds: [clinicId], clinics: [{ id: clinicId, name: clinicId, city: "HCMC" }], activeClinicId: clinicId, expiresAt: Date.now() + 3600000 });
const sessionA = session(orgA, clinicA, userA);
const sessionB = session(orgB, clinicB, userB);
let instrumentId = null;
let cycleId = null;
try {
  await prisma.organization.createMany({ data: [{ id: orgA, name: `Sterilization QA A ${suffix}`, slug: `stz-qa-a-${suffix}` }, { id: orgB, name: `Sterilization QA B ${suffix}`, slug: `stz-qa-b-${suffix}` }] });
  await prisma.clinic.createMany({ data: [{ id: clinicA, organizationId: orgA, name: `STZ Clinic A ${suffix}`, city: "HCMC", address: "QA" }, { id: clinicB, organizationId: orgB, name: `STZ Clinic B ${suffix}`, city: "HCMC", address: "QA" }] });
  await prisma.user.createMany({ data: [{ id: userA, organizationId: orgA, email: `${userA}@example.test`, fullName: "STZ QA A", passwordHash: "qa", role: "HYGIENIST" }, { id: userB, organizationId: orgB, email: `${userB}@example.test`, fullName: "STZ QA B", passwordHash: "qa", role: "HYGIENIST" }] });
  const instrument = await createSterilizationInstrumentCommand(sessionA, { code: `KIT-${suffix.slice(0, 8)}`, name: "Bộ kìm QA", category: "Kìm" });
  instrumentId = instrument.id;
  const cycle = await createSterilizationCycleCommand(sessionA, { instrumentIds: [instrument.id], method: "Autoclave", machineName: "Máy QA" });
  cycleId = cycle.id;
  assert(cycle.instruments.length === 1, "cycle records instrument membership");
  await transitionSterilizationCycleCommand(sessionA, { id: cycle.id, status: "RUNNING" });
  await transitionSterilizationCycleCommand(sessionA, { id: cycle.id, status: "PASSED" });
  const released = await transitionSterilizationCycleCommand(sessionA, { id: cycle.id, status: "RELEASED" });
  assert(released.status === "RELEASED", "passed cycle can be released");
  let invalid = false;
  try { assertSterilizationTransition("RELEASED", "RUNNING"); } catch (error) { invalid = error?.code === "sterilization-status-transition-invalid"; }
  assert(invalid, "released cycle cannot reopen");
  assert((await listSterilizationCyclesCommand(sessionB)).length === 0, "other organization cannot list cycles");
  console.log("ok phase5 sterilization scope and workflow smoke");
} finally {
  if (cycleId) await prisma.sterilizationCycle.deleteMany({ where: { id: cycleId } }).catch(() => {});
  if (instrumentId) await prisma.sterilizationInstrument.deleteMany({ where: { id: instrumentId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => {});
  await prisma.clinic.deleteMany({ where: { id: { in: [clinicA, clinicB] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => {});
  await prisma.$disconnect();
}
function assert(condition, label) { if (!condition) throw new Error(`Phase5 sterilization smoke failed: ${label}`); console.log(`ok ${label}`); }

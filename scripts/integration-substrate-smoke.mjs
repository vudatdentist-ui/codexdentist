import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const {
  acceptIntegrationInbox,
  createExternalReference,
  dispatchIntegrationOutbox,
  enqueueIntegrationOutbox,
  IntegrationScopeError,
  processIntegrationInbox,
  upsertIntegrationConnection,
} = await import("../src/infrastructure/integrations/substrate.ts");

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const suffix = randomUUID();
const provider = `qa-phase2-${suffix}`;
const topic = `qa-phase2-${suffix}`;
const unrelatedTopic = `qa-phase2-unrelated-${suffix}`;
let secondOrganizationId = null;

try {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.INTEGRATION_SMOKE_OWNER_EMAIL ?? "owner@nhavista.vn" },
    select: { id: true, organizationId: true },
  });
  const clinic = await prisma.clinic.findFirstOrThrow({
    where: { organizationId: owner.organizationId },
    select: { id: true },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: { organizationId: owner.organizationId, clinicId: clinic.id },
    select: { id: true },
  });

  const connection = await upsertIntegrationConnection(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    provider,
    capabilities: { inbound: true, outbound: true },
    secretRef: "env:QA_PHASE2_SECRET",
    metadata: { mode: "qa" },
  });
  assert(connection.organizationId === owner.organizationId, "connection tenant scope");

  const reference = await createExternalReference(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider,
    entityType: "Patient",
    internalId: patient.id,
    externalId: `external-patient-${suffix}`,
  });
  assert(reference.internalId === patient.id, "external reference mapping");

  let missingClinicDenied = false;
  try {
    await createExternalReference(prisma, {
      organizationId: owner.organizationId,
      clinicId: null,
      connectionId: connection.id,
      provider,
      entityType: "Patient",
      internalId: `missing-clinic-${suffix}`,
      externalId: `missing-clinic-external-${suffix}`,
    });
  } catch (error) {
    missingClinicDenied =
      error instanceof IntegrationScopeError &&
      error.code === "integration-tenant-mismatch";
  }
  assert(missingClinicDenied, "clinic-scoped connection requires matching clinic");

  const otherOrganization = await prisma.organization.create({
    data: { name: `QA Phase2 Tenant ${suffix}` },
    select: { id: true },
  });
  secondOrganizationId = otherOrganization.id;
  const otherClinic = await prisma.clinic.create({
    data: {
      organizationId: otherOrganization.id,
      name: `QA Phase2 Clinic ${suffix}`,
      city: "QA",
      address: "QA only",
    },
    select: { id: true },
  });

  let tenantMismatchDenied = false;
  try {
    await createExternalReference(prisma, {
      organizationId: otherOrganization.id,
      clinicId: otherClinic.id,
      connectionId: connection.id,
      provider,
      entityType: "Patient",
      internalId: `other-${suffix}`,
      externalId: `other-external-${suffix}`,
    });
  } catch (error) {
    tenantMismatchDenied =
      error instanceof IntegrationScopeError &&
      error.code === "integration-tenant-mismatch";
  }
  assert(tenantMismatchDenied, "cross-tenant external reference denied");

  const eventInput = {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    connectionId: connection.id,
    provider,
    externalEventId: `evt-${suffix}`,
    eventType: "qa.received",
    payload: { referenceId: `ref-${suffix}` },
  };
  const accepted = await acceptIntegrationInbox(prisma, eventInput);
  const duplicate = await acceptIntegrationInbox(prisma, eventInput);
  assert(!accepted.duplicate && duplicate.duplicate, "duplicate inbox event deduped");

  let firstAttemptFailed = false;
  try {
    await processIntegrationInbox(
      prisma,
      accepted.event.id,
      async (tx) => {
        await tx.auditLog.create({
          data: {
            organizationId: owner.organizationId,
            action: "qa.integration.domain_mutation",
            entityType: "QAIntegration",
            entityId: accepted.event.id,
            metadata: { marker: suffix },
          },
        });
        await enqueueIntegrationOutbox(tx, {
          organizationId: owner.organizationId,
          clinicId: clinic.id,
          topic,
          eventType: "qa.dispatch",
          aggregateType: "QAIntegration",
          aggregateId: accepted.event.id,
          dedupeKey: `qa:${accepted.event.id}`,
          payload: { inboxId: accepted.event.id },
        });
        const error = new Error("simulated provider processing failure");
        error.code = "qa-handler-failed";
        throw error;
      },
      { retryDelayMs: 1 },
    );
  } catch {
    firstAttemptFailed = true;
  }
  assert(firstAttemptFailed, "failed inbox handler surfaced");

  const rolledBackMutationCount = await prisma.auditLog.count({
    where: {
      organizationId: owner.organizationId,
      action: "qa.integration.domain_mutation",
      entityId: accepted.event.id,
    },
  });
  const rolledBackOutbox = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "IntegrationOutbox" WHERE "organizationId" = $1 AND "topic" = $2`,
    owner.organizationId,
    topic,
  );
  assert(rolledBackMutationCount === 0, "failed inbox domain mutation rolled back");
  assert(rolledBackOutbox.length === 0, "failed inbox outbox rolled back atomically");

  await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationInbox" SET "availableAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    accepted.event.id,
  );
  const processed = await processIntegrationInbox(prisma, accepted.event.id, async (tx) => {
    await tx.auditLog.create({
      data: {
        organizationId: owner.organizationId,
        action: "qa.integration.domain_mutation",
        entityType: "QAIntegration",
        entityId: accepted.event.id,
        metadata: { marker: suffix },
      },
    });
    return enqueueIntegrationOutbox(tx, {
      organizationId: owner.organizationId,
      clinicId: clinic.id,
      topic,
      eventType: "qa.dispatch",
      aggregateType: "QAIntegration",
      aggregateId: accepted.event.id,
      dedupeKey: `qa:${accepted.event.id}`,
      payload: { inboxId: accepted.event.id },
    });
  });
  assert(processed.status === "processed", "inbox retry processed");

  let replayHandlerCalled = false;
  const replay = await processIntegrationInbox(prisma, accepted.event.id, async () => {
    replayHandlerCalled = true;
  });
  assert(replay.status === "already_processed", "processed inbox replay is idempotent");
  assert(!replayHandlerCalled, "processed inbox replay skipped handler");

  const committedMutationCount = await prisma.auditLog.count({
    where: {
      organizationId: owner.organizationId,
      action: "qa.integration.domain_mutation",
      entityId: accepted.event.id,
    },
  });
  const outboxRows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "IntegrationOutbox" WHERE "organizationId" = $1 AND "topic" = $2`,
    owner.organizationId,
    topic,
  );
  assert(committedMutationCount === 1, "domain mutation committed exactly once");
  assert(outboxRows.length === 1, "outbox committed exactly once with domain mutation");

  const unrelated = await enqueueIntegrationOutbox(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    topic: unrelatedTopic,
    eventType: "qa.unrelated",
    dedupeKey: `qa-unrelated:${suffix}`,
    payload: { marker: suffix },
  });

  const dispatchFailure = await dispatchIntegrationOutbox(
    prisma,
    async () => {
      const error = new Error("provider unavailable");
      error.code = "qa-provider-down";
      throw error;
    },
    {
      topic,
      organizationId: owner.organizationId,
      retryDelayMs: 1,
    },
  );
  assert(dispatchFailure.claimed === 1, "dispatcher claims only requested topic");
  assert(dispatchFailure.retried === 1, "provider failure scheduled outbox retry");

  const unrelatedAfterDispatch = await prisma.$queryRawUnsafe(
    `SELECT "status", "attempts" FROM "IntegrationOutbox" WHERE "id" = $1`,
    unrelated.event.id,
  );
  assert(
    unrelatedAfterDispatch[0]?.status === "PENDING" &&
      Number(unrelatedAfterDispatch[0]?.attempts) === 0,
    "dispatcher leaves unrelated topic untouched",
  );

  const afterFailure = await prisma.$queryRawUnsafe(
    `SELECT "status", "attempts" FROM "IntegrationOutbox" WHERE "id" = $1`,
    outboxRows[0].id,
  );
  assert(afterFailure[0]?.status === "RETRY", "outbox remains retryable after provider outage");
  const mutationAfterProviderFailure = await prisma.auditLog.count({
    where: {
      organizationId: owner.organizationId,
      action: "qa.integration.domain_mutation",
      entityId: accepted.event.id,
    },
  });
  assert(mutationAfterProviderFailure === 1, "provider outage did not corrupt committed domain state");

  const retryAudit = await prisma.auditLog.findFirst({
    where: {
      organizationId: owner.organizationId,
      action: "integration.outbox_retry_scheduled",
      entityId: outboxRows[0].id,
    },
  });
  assert(Boolean(retryAudit), "outbox retry is auditable");

  await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationOutbox" SET "availableAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    outboxRows[0].id,
  );
  const deliveredIds = [];
  const dispatchSuccess = await dispatchIntegrationOutbox(
    prisma,
    async (event) => {
      deliveredIds.push(event.id);
    },
    { topic, organizationId: owner.organizationId },
  );
  assert(dispatchSuccess.sent === 1, "outbox retry dispatched successfully");
  assert(deliveredIds.length === 1, "transport invoked exactly once on successful retry");

  const finalOutbox = await prisma.$queryRawUnsafe(
    `SELECT "status", "attempts" FROM "IntegrationOutbox" WHERE "id" = $1`,
    outboxRows[0].id,
  );
  assert(finalOutbox[0]?.status === "SENT", "outbox marked sent");
  assert(Number(finalOutbox[0]?.attempts) === 2, "outbox attempts record failure plus retry");

  console.log("ok phase2 integration substrate smoke");
} finally {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { action: "qa.integration.domain_mutation" },
        { action: { in: ["integration.inbox_retry_scheduled", "integration.inbox_failed", "integration.outbox_retry_scheduled", "integration.outbox_failed"] } },
      ],
      metadata: { path: ["marker"], equals: suffix },
    },
  }).catch(() => {});
  await prisma.$executeRawUnsafe(
    `DELETE FROM "AuditLog" WHERE "entityType" IN ('IntegrationInbox', 'IntegrationOutbox') AND "organizationId" IN (SELECT "organizationId" FROM "IntegrationConnection" WHERE "provider" = $1)`,
    provider,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(
    `DELETE FROM "IntegrationOutbox" WHERE "topic" IN ($1, $2)`,
    topic,
    unrelatedTopic,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "IntegrationInbox" WHERE "provider" = $1`, provider).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "ExternalReference" WHERE "provider" = $1`, provider).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "IntegrationConnection" WHERE "provider" = $1`, provider).catch(() => {});
  if (secondOrganizationId) {
    await prisma.clinic.deleteMany({ where: { organizationId: secondOrganizationId } }).catch(() => {});
    await prisma.organization.delete({ where: { id: secondOrganizationId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase2 integration smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

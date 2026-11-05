const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");

const globals = { Request, Response, FormData, Blob, File };
const secrets = { apiToken: "synthetic", webhookSecret: "synthetic", baseUrl: "https://provider.test/api/v2" };
const metadataOf = (row) => row?.metadata ?? {};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function mutex() {
  let tail = Promise.resolve();
  return async () => {
    const previous = tail;
    const next = deferred();
    tail = next.promise;
    await previous;
    return next.resolve;
  };
}

function signingFixture({ failure = "http", providerStatusAfterFailure = "DRAFT", legacy = false } = {}) {
  const form = {
    id: "form", formNo: "FRM-1", organizationId: "org", clinicId: "clinic", patientId: "patient",
    status: "SENT", signatureUrl: null, attachments: ["/patient-files/source"],
    template: { name: "Consent", requiresSignature: true },
    patient: { fullName: "Synthetic signer", email: "synthetic@example.test", clinicId: "clinic" },
  };
  let connection = { id: "organization-connection", organizationId: "org", clinicId: null,
    provider: "documenso", status: "ACTIVE", secretRef: "vault:v1" };
  const sourceFile = { id: "source", virusScanStatus: "CLEAN", storageKey: "synthetic/source.pdf", storageProvider: "local", sourceType: "LOCAL_UPLOAD" };
  const references = [];
  const calls = [];
  let distributions = 0;
  let sourceReads = 0;
  let beforeDistribute = async () => {};
  let providerStatus = "DRAFT";
  const acquire = mutex();
  const locks = [];
  const createReference = async (_db, input) => {
    const existing = references.find((row) => row.entityType === input.entityType && row.connectionId === input.connectionId && row.internalId === input.internalId);
    if (existing) {
      assert.equal(existing.externalId, input.externalId);
      return { ...existing, created: false };
    }
    const row = { id: `ref-${references.length}`, ...input };
    references.push(row);
    return { ...row, created: true };
  };
  const updateMetadata = async (_db, id, metadata) => {
    const row = references.find((candidate) => candidate.id === id);
    assert.ok(row);
    // Match the store's terminal-state protection, including callback races.
    if (!["SIGNED", "SETTLED"].includes(row.metadata.status)) row.metadata = { ...metadata };
    return { ...row };
  };
  const prisma = {
    patientForm: { findFirst: async () => ({ ...form }) },
    patientFile: { findFirst: async () => ({ ...sourceFile }) },
    auditLog: { create: async () => ({}) },
    $transaction: async (callback) => {
      const release = await acquire();
      let locked = false;
      const tx = {
        $queryRawUnsafe: async (sql) => {
          if (sql.includes('FROM "IntegrationConnection"')) return [{ ...connection }];
          if (sql.includes('FROM "PatientFile"')) return [{ id: "source" }];
          assert.ok(sql.includes('FROM "Patient"'));
          return [{ id: "patient" }];
        },
        patientFile: { findFirst: async () => { assert.ok(locked); return { ...sourceFile }; } },
        $executeRaw: async (sql, ...values) => {
          assert.match(sql.join("?"), /FROM "PatientForm"[\s\S]*FOR UPDATE/);
          assert.deepEqual(values, ["form", "org", "clinic", "patient"]);
          locked = true;
          locks.push("form");
        },
        patientForm: { findFirst: async () => { assert.ok(locked); return { ...form }; } },
        $queryRaw: async (sql, ...values) => {
          assert.ok(locked);
          assert.match(sql.join("?"), /'DOCUMENSO_REQUEST'/);
          assert.doesNotMatch(sql.join("?"), /"connectionId"\s*=/);
          assert.deepEqual(values, ["org", "form"]);
          return references.filter((row) => row.entityType === "DOCUMENSO_REQUEST").map((row) => ({ ...row }));
        },
      };
      try { return await callback(tx); } finally { release(); }
    },
  };
  const client = load("src/integrations/documenso/client.ts", {}, {
    ...globals,
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/envelope/create")) return Response.json({ id: "envelope-one" });
      if (url.endsWith("/envelope/envelope-one")) {
        return Response.json({ id: "envelope-one", status: providerStatus, recipients: [{ signingUrl: "https://provider.test/sign/synthetic" }] });
      }
      assert.ok(url.endsWith("/envelope/distribute"), url);
      assert.equal(JSON.parse(init.body).envelopeId, "envelope-one");
      const owner = references.find((row) => row.entityType === "DOCUMENSO_REQUEST");
      assert.equal(owner.metadata.envelopeId, "envelope-one", "ID is durable before distribution");
      assert.ok(references.some((row) => row.entityType === "DOCUMENSO_ENVELOPE"));
      await beforeDistribute();
      if (++distributions === 1 && failure) {
        providerStatus = providerStatusAfterFailure;
        if (failure === "network") throw new TypeError("synthetic connection reset");
        return Response.json({ message: "synthetic unavailable" }, { status: 503 });
      }
      providerStatus = "PENDING";
      return Response.json({ recipients: [{ signingUrl: "https://provider.test/sign/synthetic" }] });
    },
  });
  const route = load("src/app/api/integrations/documenso/signing-requests/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { getSession: async () => ({ organizationId: "org", userId: "staff", clinicIds: ["clinic"] }) },
    "@/lib/env": { appBaseUrl: () => "https://app.test" },
    "@/lib/forms": { canMutateForms: () => true },
    "@/lib/patient-file-storage": { readStoredPatientFile: async () => { sourceReads++; return Buffer.from("%PDF-1.4\nsynthetic"); } },
    "@/lib/prisma": { prisma },
    "@/infrastructure/integrations/substrate": { createExternalReference: createReference },
    "@/infrastructure/integrations/phase3-store": {
      findActiveIntegrationConnection: async () => ({ ...connection }),
      referenceMetadata: metadataOf, updateExternalReferenceMetadataWithRetry: updateMetadata,
      // Old code is intentionally executable so these regressions expose its behavior.
      getExternalReferenceByInternalId: async (_db, input) => references.find((row) => row.entityType === input.entityType && row.connectionId === input.connectionId),
      claimExternalReferenceForRetry: async (_db, id) => references.find((row) => row.id === id),
    },
    "../connection-secrets": { documensoConnectionSecrets: async () => secrets },
    "@/integrations/documenso/client": client,
    "@/lib/request-security": { hasSameOrigin: () => true },
    "@/lib/patient-access": { allowedClinicIds: () => ["clinic"] },
    "@/lib/resource-policy": { canServePatientFile: () => true },
  }, globals);
  if (legacy) references.push({ id: "legacy", organizationId: "org", clinicId: "clinic", connectionId: connection.id,
    provider: "documenso", entityType: "DOCUMENSO_REQUEST", internalId: "form", externalId: "request-one",
    metadata: { sourcePatientFileId: "source", idempotencyKey: "consent-key", envelopeId: "envelope-one",
      recipientName: form.patient.fullName, recipientEmail: form.patient.email,
      status: "PENDING", errorCode: "documenso-envelope-distribute-failed" } });
  return {
    form, references, calls, locks,
    setConnection: (id) => { connection = { ...connection, id }; },
    setBeforeDistribute: (callback) => { beforeDistribute = callback; },
    sourceReads: () => sourceReads,
    post: (overrides = {}) => route.POST(new Request("https://app.test/api/integrations/documenso/signing-requests", {
      method: "POST", body: JSON.stringify({ patientFormId: "form", sourcePatientFileId: "source", idempotencyKey: "consent-key", ...overrides }),
    })),
  };
}

for (const failure of ["http", "network"]) {
  test(`actual POST resumes the same draft after ${failure} distribution failure`, async () => {
    const fixture = signingFixture({ failure });
    assert.equal((await fixture.post()).status, 502);
    const owner = fixture.references.find((row) => row.entityType === "DOCUMENSO_REQUEST");
    assert.equal(owner.metadata.envelopeId, "envelope-one");
    const retry = await fixture.post();
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).signingUrl, "https://provider.test/sign/synthetic");
    assert.equal(fixture.calls.filter((call) => call.url.endsWith("/create")).length, 1);
    assert.equal(fixture.calls.filter((call) => call.url.endsWith("/distribute")).length, 2);
    assert.equal(fixture.sourceReads(), 1);
    assert.equal(owner.metadata.distributionStatus, "SENT");
    assert.equal((await (await fixture.post()).json()).duplicate, true);
    assert.equal(fixture.calls.length, 4);
  });
}

test("lost distribution response is recovered from provider PENDING without another send", async () => {
  const fixture = signingFixture({ failure: "network", providerStatusAfterFailure: "PENDING" });
  assert.equal((await fixture.post()).status, 502);
  assert.equal((await fixture.post()).status, 200);
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/distribute")).length, 1);
});

test("a retry without the optional key preserves the original ceremony identity", async () => {
  const fixture = signingFixture();
  assert.equal((await fixture.post()).status, 502);
  assert.equal((await fixture.post({ idempotencyKey: "" })).status, 200);
  assert.equal(fixture.references[0].metadata.idempotencyKey, "consent-key");
  assert.equal((await fixture.post({ idempotencyKey: "different-key" })).status, 409);
});

test("legacy PENDING plus distribution error resumes rather than returning false duplicate", async () => {
  const fixture = signingFixture({ failure: null, legacy: true });
  const response = await fixture.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).signingUrl, "https://provider.test/sign/synthetic");
  assert.equal(fixture.calls.some((call) => call.url.endsWith("/create")), false);
  assert.equal(fixture.calls.filter((call) => call.url.endsWith("/distribute")).length, 1);
});

test("an expired distribution claim resumes its durable envelope after process interruption", async () => {
  const fixture = signingFixture({ failure: null, legacy: true });
  fixture.references[0].metadata.status = "DISTRIBUTING";
  fixture.references[0].metadata.distributionStatus = "PENDING";
  fixture.references[0].metadata.attemptStartedAt = new Date(Date.now() - 121_000).toISOString();
  assert.equal((await fixture.post()).status, 200);
  assert.equal(fixture.calls.some((call) => call.url.endsWith("/create")), false);
  assert.equal(fixture.sourceReads(), 0);
});

test("a connection change during a pending provider request cannot claim the form", async () => {
  const fixture = signingFixture({ failure: null });
  const entered = deferred(), finish = deferred();
  fixture.setBeforeDistribute(async () => { entered.resolve(); await finish.promise; });
  const first = fixture.post();
  await entered.promise;
  fixture.setConnection("new-clinic-connection");
  const response = await fixture.post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "documenso-ceremony-ownership-conflict");
  finish.resolve();
  assert.equal((await first).status, 200);
  assert.equal(fixture.calls.length, 2);
});

test("provider connection changes cannot create a second ceremony for an open form", async () => {
  const fixture = signingFixture({ failure: null });
  assert.equal((await fixture.post()).status, 200);
  fixture.setConnection("new-clinic-connection");
  const response = await fixture.post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "documenso-ceremony-ownership-conflict");
  assert.equal(fixture.references.filter((row) => row.entityType === "DOCUMENSO_REQUEST").length, 1);
  assert.equal(fixture.calls.length, 2);
});

test("concurrent POST while distribution is in flight cannot issue another envelope/send", async () => {
  const fixture = signingFixture({ failure: null });
  const entered = deferred(), finish = deferred();
  fixture.setBeforeDistribute(async () => { entered.resolve(); await finish.promise; });
  const first = fixture.post();
  await entered.promise;
  const duplicate = await fixture.post();
  assert.equal(duplicate.status, 409);
  finish.resolve();
  assert.equal((await first).status, 200);
  assert.equal(fixture.calls.length, 2);
  assert.ok(fixture.locks.length >= 2);
});

test("client network errors and failed persistence retain ID without sending before persistence", async () => {
  let sends = 0;
  const client = load("src/integrations/documenso/client.ts", {}, { ...globals, fetch: async (url) => {
    if (url.endsWith("/create")) return Response.json({ id: "envelope-one" });
    sends++;
    throw new TypeError("synthetic disconnect");
  } });
  const input = { externalId: "form", title: "Consent", pdfBytes: Buffer.from("%PDF-1.4"), fileName: "source.pdf", recipientEmail: "synthetic@example.test", recipientName: "Synthetic" };
  await assert.rejects(client.createDocumensoSigningEnvelope(secrets, input),
    (error) => error.code === "documenso-envelope-distribute-failed" && error.envelopeId === "envelope-one");
  assert.equal(sends, 1);
  await assert.rejects(client.createDocumensoSigningEnvelope(secrets, input, async () => { throw Error("synthetic persistence failure"); }),
    (error) => error.code === "documenso-envelope-persist-failed" && error.envelopeId === "envelope-one");
  assert.equal(sends, 1);
});

for (const status of ["REJECTED", "CANCELLED", "UNKNOWN"]) {
  test(`resume rejects ${status} and retains ownership instead of creating a ceremony`, async () => {
    let reads = 0;
    const client = load("src/integrations/documenso/client.ts", {}, { ...globals, fetch: async () => {
      reads++;
      return Response.json({ id: "envelope-one", status });
    } });
    await assert.rejects(client.resumeDocumensoSigningEnvelope(secrets, "envelope-one"),
      (error) => error.code === "documenso-envelope-not-open" && error.envelopeId === "envelope-one");
    assert.equal(reads, 1);
  });
}

test("resume refuses an unrelated provider envelope and preserves the requested ID", async () => {
  const client = load("src/integrations/documenso/client.ts", {}, { ...globals,
    fetch: async () => Response.json({ id: "other-envelope", status: "DRAFT" }) });
  await assert.rejects(client.resumeDocumensoSigningEnvelope(secrets, "envelope-one"),
    (error) => error.code === "documenso-envelope-id-mismatch" && error.envelopeId === "envelope-one");
});

function reconciliationFixture() {
  const form = { id: "form", formNo: "FRM-1", status: "SENT", signatureUrl: null, attachments: [], template: { requiresSignature: true } };
  const owners = [{ clinicId: "clinic", metadata: { envelopeId: "envelope-one" } }];
  const events = [];
  const acquire = mutex();
  let beforeFile = async () => {};
  let afterLock = async () => {};
  const command = load("src/lib/application/forms/provider-signing.ts", {
    "@/infrastructure/integrations/substrate": { enqueueIntegrationOutbox: async () => { events.push("outbox"); } },
    "@/infrastructure/integrations/phase3-store": { referenceMetadata: metadataOf },
    "@/infrastructure/patient-files/staging": { markPatientFileStageCommitted: async () => { events.push("stage"); } },
  });
  return {
    form, owners, events,
    setBeforeFile: (callback) => { beforeFile = callback; },
    setAfterLock: (callback) => { afterLock = callback; },
    execute: async (overrides = {}) => {
      let release;
      const tx = {
        $executeRaw: async (sql, ...values) => {
          assert.match(sql.join("?"), /FROM "PatientForm"[\s\S]*FOR UPDATE/);
          assert.deepEqual(values, ["form", "org", "clinic", "patient"]);
          release = await acquire();
          events.push("lock");
          await afterLock();
        },
        $queryRaw: async (sql, ...values) => {
          assert.ok(release, "ownership read follows form lock");
          assert.match(sql.join("?"), /'DOCUMENSO_REQUEST'/);
          assert.doesNotMatch(sql.join("?"), /"connectionId"\s*=/);
          assert.deepEqual(values, ["org", "documenso", "form"]);
          return owners;
        },
        patientForm: {
          findFirst: async ({ where }) => {
            assert.ok(release, "form read follows lock");
            assert.deepEqual(JSON.parse(JSON.stringify(where)), { id: "form", organizationId: "org", clinicId: "clinic", patientId: "patient" });
            events.push("read");
            return { ...form };
          },
          updateMany: async ({ where, data }) => {
            assert.equal(where.signatureUrl, null);
            assert.deepEqual([...where.status.in], ["DRAFT", "SENT"]);
            if (![...where.status.in].includes(form.status) || form.signatureUrl !== null) return { count: 0 };
            Object.assign(form, data);
            events.push("form");
            return { count: 1 };
          },
        },
        patientFile: { create: async () => { await beforeFile(); events.push("file"); } },
        journeyComment: { create: async () => { events.push("journey"); return { id: "journey" }; } },
        auditLog: { create: async () => { events.push("audit"); } },
      };
      try {
        return await command.reconcileSignedPatientFormCommand(tx, {
          organizationId: "org", clinicId: "clinic", patientId: "patient", patientFormId: "form",
          stageId: "stage", patientFileId: "file-one", provider: "documenso", externalEnvelopeId: "envelope-one",
          storedUpload: { fileName: "signed.pdf", mimeType: "application/pdf", sizeBytes: 20, storageProvider: "local", relativePath: "synthetic", storageKey: "synthetic", checksumSha256: "synthetic" },
          ...overrides,
        });
      } finally { release?.(); }
    },
  };
}

test("owned completion commits file, consent, Journey, outbox and audit once; exact replay is inert", async () => {
  const fixture = reconciliationFixture();
  assert.equal((await fixture.execute()).status, "reconciled");
  assert.equal(fixture.form.signatureUrl, "/patient-files/file-one");
  assert.deepEqual(fixture.events, ["lock", "read", "file", "stage", "form", "journey", "outbox", "audit"]);
  assert.equal((await fixture.execute()).status, "already_reconciled");
  assert.equal(fixture.events.filter((event) => event === "file").length, 1);
});

test("completed consent cannot be replaced by another callback's file", async () => {
  const fixture = reconciliationFixture();
  await fixture.execute();
  await assert.rejects(fixture.execute({ patientFileId: "file-two" }), (error) => error.code === "signed-form-already-completed");
  assert.equal(fixture.form.signatureUrl, "/patient-files/file-one");
  assert.equal(fixture.events.filter((event) => event === "file").length, 1);
});

for (const mismatch of ["envelope", "clinic", "multiple", "missing"]) {
  test(`completion rejects ${mismatch} ceremony ownership before side effects`, async () => {
    const fixture = reconciliationFixture();
    if (mismatch === "envelope") fixture.owners[0].metadata.envelopeId = "other-envelope";
    if (mismatch === "clinic") fixture.owners[0].clinicId = "other-clinic";
    if (mismatch === "multiple") fixture.owners.push({ ...fixture.owners[0] });
    if (mismatch === "missing") fixture.owners.length = 0;
    await assert.rejects(fixture.execute(), (error) => error.code === "signed-form-ceremony-ownership-conflict");
    assert.deepEqual(fixture.events, ["lock", "read"]);
  });
}

test("concurrent callbacks serialize on form and cannot replace the first committed file", async () => {
  const fixture = reconciliationFixture();
  const entered = deferred(), finish = deferred();
  fixture.setBeforeFile(async () => { entered.resolve(); await finish.promise; });
  const first = fixture.execute();
  await entered.promise;
  const second = fixture.execute({ patientFileId: "file-two" });
  const rejected = assert.rejects(second, (error) => error.code === "signed-form-already-completed");
  assert.equal(fixture.events.filter((event) => event === "read").length, 1);
  finish.resolve();
  assert.equal((await first).status, "reconciled");
  await rejected;
  assert.equal(fixture.form.signatureUrl, "/patient-files/file-one");
  assert.equal(fixture.events.filter((event) => event === "journey").length, 1);
});

test("void winning the form lock is observed before completion can write", async () => {
  const fixture = reconciliationFixture();
  fixture.setAfterLock(async () => { fixture.form.status = "VOID"; });
  await assert.rejects(fixture.execute(), (error) => error.code === "signed-form-void");
  assert.deepEqual(fixture.events, ["lock", "read"]);
});

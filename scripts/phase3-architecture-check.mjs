import { readFile } from "node:fs/promises";

const files = {
  payosClient: "src/integrations/payos/client.ts",
  documensoClient: "src/integrations/documenso/client.ts",
  payosWebhook: "src/app/api/integrations/payos/webhooks/[connectionId]/route.ts",
  payosLink: "src/app/api/integrations/payos/payment-links/route.ts",
  documensoWebhook: "src/app/api/integrations/documenso/webhooks/[connectionId]/route.ts",
  documensoRequest: "src/app/api/integrations/documenso/signing-requests/route.ts",
  connectionRoute: "src/app/api/integrations/connections/route.ts",
  settlement: "src/lib/application/revenue/provider-settlement.ts",
  signedForm: "src/lib/application/forms/provider-signing.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

for (const key of ["payosClient", "documensoClient"]) {
  assert(!/@prisma|lib\/prisma|infrastructure\//.test(source[key]), `${key} is provider-only`);
}

assertOrder(
  source.payosWebhook,
  "verifyPayOSWebhookPayload(",
  "acceptIntegrationInbox(",
  "payOS webhook verifies before inbox acceptance",
);
assertOrder(
  source.documensoWebhook,
  "verifyDocumensoWebhook(",
  "acceptIntegrationInbox(",
  "Documenso webhook verifies before inbox acceptance",
);
assert(
  source.payosWebhook.includes("recordProviderSettlementCommand("),
  "payOS settlement invokes Revenue application command",
);
assert(
  !/\.receipt\.(create|update|upsert)|\.invoice\.(create|update|upsert)|\.payment\.(create|update|upsert)/.test(
    source.payosWebhook,
  ),
  "payOS transport does not write billing tables directly",
);
assert(
  source.documensoWebhook.includes("createPatientFileStage(") &&
    source.documensoWebhook.includes("markPatientFileStageStored(") &&
    source.documensoWebhook.includes("reconcileSignedPatientFormCommand("),
  "Documenso completion uses staged file lifecycle and form application command",
);
assertOrder(
  source.documensoWebhook,
  "createPatientFileStage(",
  "storePatientUpload(",
  "Documenso creates DB stage before object write",
);
assert(
  source.documensoWebhook.includes('entityType: "DOCUMENSO_REQUEST"') &&
    source.documensoWebhook.includes("internalId: minimal.externalId") &&
    source.documensoWebhook.includes("initiatedRequest?.clinicId"),
  "Documenso recovery requires a previously initiated Codex request",
);
assert(
  source.documensoRequest.includes("readStoredPatientFile(sourceFile)") &&
    source.documensoRequest.includes("externalId: patientForm.id") &&
    source.documensoRequest.includes("fileName: `form-${patientForm.formNo}.pdf`") &&
    !source.documensoRequest.includes("patient.phone") &&
    !source.documensoRequest.includes("dateOfBirth"),
  "Documenso request minimizes external patient data",
);
assert(
  source.documensoRequest.includes('entityType: "DOCUMENSO_REQUEST"') &&
    source.documensoRequest.includes("internalId: patientForm.id"),
  "Documenso signing idempotency is anchored to PatientForm",
);
assert(
  source.payosLink.includes("organizationId: session.organizationId") &&
    source.payosLink.includes("clinicId: patient.clinicId") &&
    source.payosLink.includes('provider: "payos"'),
  "payOS payment link is tenant and clinic scoped",
);
assert(
  source.connectionRoute.includes('hasAnyRole(session, ["OWNER", "AREA_MANAGER"])') &&
    source.connectionRoute.includes('return error("integration-clinic-required", 403)'),
  "organization-wide provider configuration is privileged",
);
assert(
  source.settlement.includes('action: "billing.provider_settlement_recorded"') &&
    source.settlement.includes("nextDocumentNo({"),
  "Revenue provider settlement preserves canonical receipt/audit flow",
);
assert(
  source.signedForm.includes('status: "COMPLETED"') &&
    source.signedForm.includes('action: "patient_form.signed_reconciled"') &&
    source.signedForm.includes('topic: "patient-files"'),
  "signed form reconciliation updates consent, audit, and patient-file outbox",
);

console.log("phase3-architecture-check: ok");

function assertOrder(text, first, second, label) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert(firstIndex >= 0 && secondIndex > firstIndex, label);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase3 architecture check failed: ${label}`);
  console.log(`ok ${label}`);
}

# Codexdentist QA Playbook

Last updated: 2026-08-27
Status: ACTIVE

This playbook implements the closed-loop quality process defined in `docs/PROJECT_CONTEXT.md`:

```text
baseline -> implement -> audit -> classify -> fix -> re-audit -> repeat -> phase exit
```

A passing build alone is not enough. Every changed high-risk boundary must pass its focused negative/regression tests before a phase can close.

## 1. Universal Baseline Gate

Run before and after every non-trivial phase/change:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run test:security
npm run test:tenant
```

For changes that can affect bundling, routes, server/client boundaries, runtime imports, or public artifacts, also run:

```bash
npm run build
npm run test:smoke
```

For visible workflow/layout changes, also run:

```bash
npm run browser:qa
```

Do not suppress a failing safety test to complete a phase. Classify the failure, fix it, and repeat the relevant gate.

## 2. Finding Severity

- **Blocker**: cross-tenant access, authorization bypass, PHI exposure, data loss/corruption, billing reconciliation/concurrency failure, destructive migration without safe restore, provider bypass of canonical application boundary, or broken production boot for the changed path.
- **High**: violated documented domain invariant, missing idempotency on externally retried mutations, protected-file lifecycle failure, incorrect clinical history/revision behavior, or architecture dependency that allows core business rules to be bypassed.
- **Medium**: maintainability/design defect that violates the target architecture or creates likely future duplication but does not currently expose/corrupt data.
- **Advisory**: improvement that does not violate the current phase exit criteria.

Phase exit requires zero unresolved Blocker/High findings and no Medium finding that violates an explicit exit criterion.

## 3. Change-to-Gate Matrix

| Changed surface | Required focused gates |
| --- | --- |
| Documentation / architecture tooling only | `encoding:check`, `typecheck`, `agent:audit`; manually compare docs and checker rules for consistency. |
| Shared UI / CSS / shell | universal gate + `build`; add `browser:qa` for responsive/layout/interaction changes. |
| Route / Server Action / route handler | universal gate + `build` + `test:smoke`; add affected domain and browser gates. |
| Permission / auth / tenant scope | `test:roles`, `test:actions`, `test:tenant`, `test:security`, `test:security-runtime`, plus affected smoke tests. |
| Revenue / billing | `test:billing`, `test:billing-concurrency`, `test:data-integrity`, `test:tenant`, `test:security`. |
| Journey / clinical | `test:integration`, `test:tenant`, `test:security`, `test:data-integrity`, affected odontogram/manual checks, `browser:qa` when UI changes. |
| Patient files / storage | `test:patient-files`, `test:tenant`, `test:security`, `test:data-integrity`; add lifecycle/reconciliation tests for staged-file work. |
| Compensation / payroll | `test:compensation`, `test:source-commission`, `test:data-integrity`, `test:tenant`. |
| Prisma schema / migrations | universal gate + affected domain tests + migration review + backup/restore consideration; never use reset to make a migration pass. |
| Integration inbox/outbox/provider | universal gate + new provider/inbox/outbox idempotency tests + affected domain gates + `test:data-integrity`. |
| Deployment / self-host | `build`, `readiness:check`, self-host compose/build checks, and relevant health/restore checks from `OPERATIONS.md`. |

## 4. Architecture Audit Contract

`npm run agent:audit` must enforce the active target architecture without assuming that legacy code has already been migrated.

New architecture roots:

```text
src/shared
src/domains
src/features
src/infrastructure
src/integrations
src/workspaces
```

Required principles:

- `shared` remains business-agnostic.
- `domains` cannot depend on Next.js, Prisma, provider SDKs, app routes, workspaces, or concrete infrastructure.
- `features` cannot depend on app/workspace UI or concrete provider adapters.
- `infrastructure` does not depend on app/workspace UI and does not own product workflow policy.
- `integrations` cannot depend on app/workspace UI and cannot directly import Prisma/core DB implementations to mutate canonical domain records.
- `workspaces` cannot depend on app routes, Prisma/storage implementations, or concrete provider adapters.
- `app` is the allowed composition/transport layer.
- Existing `src/components`, `src/modules`, and broad `src/lib` remain migration territory. Do not add a route-specific migration exception or a legacy component name as the architecture target.

Architecture checks should become stricter as code is migrated, not by retroactively declaring all baseline legacy code invalid.

## 5. Phase 0 Gate — Context And Enforcement Reset

Required evidence:

- `PROJECT_CONTEXT.md` explicitly supersedes prior product/refactor contexts.
- `AGENTS.md`, this playbook, and the architecture checker agree on the same target layers.
- No active QA instruction requires the retired `/today`, `/work`, `/patients/[patientId]`, `/operations/finance` migration plan.
- Architecture tooling has no active `DentalSuite/AppViewPage` migration rule.
- `infrastructure` and `integrations` are recognized by architecture tooling.
- Obsolete deploy-target wording is removed when it can be mistaken for current direction.

Commands:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
```

If one fails, fix and rerun all three before Phase 0 closes.

## 6. Phase 1 Gate — Application Boundary

For each migrated use-case:

1. Verify the Server Action/route handler performs transport concerns only: parse, authenticate, dispatch, map response/revalidate/redirect.
2. Verify business rules live in one application command/use-case.
3. Verify authorization and tenant/clinic scope cannot be skipped by another transport.
4. Verify a job/webhook/API could invoke the same application command without importing UI code.
5. Search for duplicated old mutation logic and remove/delegate it once safe.

Revenue migration must pass:

```bash
npm run test:billing
npm run test:billing-concurrency
npm run test:data-integrity
npm run test:tenant
npm run test:security
```

Journey/file migration must pass:

```bash
npm run test:integration
npm run test:patient-files
npm run test:data-integrity
npm run test:tenant
npm run test:security
```

## 7. Phase 2 Gate — Integration Substrate And File Lifecycle

Add automated tests for at least:

- duplicate inbox event ID;
- same webhook replayed after success;
- processing failure followed by retry;
- outbox event committed with its required domain transaction;
- dispatcher/provider failure without rollback/corruption of committed core state;
- tenant mismatch on external reference;
- staged file created but DB commit fails;
- staged object reconciliation/garbage collection;
- committed protected file remains inaccessible across tenant/clinic boundary.

Run affected schema/data integrity and protected-file suites after every fix.

## 8. Phase 3 Gate — payOS / Documenso

### payOS

Verify:

- signature validation before processing;
- tenant/clinic mapping through trusted internal references;
- duplicate, delayed and reordered notifications;
- amount/currency/reference validation;
- application Revenue command is the only path that records settlement;
- no provider adapter imports Prisma/core billing repository implementation directly;
- billing reconciliation and concurrency suites remain green.

### Documenso

Verify:

- only minimized necessary participant/document data leaves Codexdentist;
- webhook/event verification and inbox idempotency;
- retry-safe signed-document retrieval;
- signed PDF passes protected-file validation/lifecycle;
- consent status, file record, Journey event and audit record reconcile after failure/retry;
- disabled/unavailable provider does not break unrelated clinical workflows.

## 9. Phase 4 Gate — Orthanc / OHIF

Verify:

- tenant/clinic/patient-scoped imaging references;
- no DICOM blob storage in PostgreSQL;
- stable patient/study mapping rather than name/email heuristics;
- authorization before viewer/study access;
- cross-tenant and inaccessible-clinic negative tests;
- unavailable PACS behavior is safe and understandable;
- backup/restore ownership for imaging data is documented;
- supported desktop/mobile workflow has no critical overflow/navigation break.

## 10. Phase 5 Gate — Native Dental Operations

For Lab/Sterilization or other native dental capabilities:

- use canonical Organization/Clinic/Patient/Staff references rather than creating parallel identities;
- permissions are server enforced;
- audit trail exists for clinically/operationally significant transitions;
- Journey gets a projection/event only where useful; Journey does not become owner of the entire module;
- inventory/material effects remain transactionally and tenant safe;
- no imported PMS becomes a second source of truth.

Run tenant, action permission, data-integrity, smoke, and browser gates plus feature-specific tests.

## 11. Phase 6 Gate — Optional Communication / FHIR

Verify:

- provider adapters can be disabled without breaking core workflows;
- notification provider abstraction works without leaking vendor objects into domains;
- Chatwoot mapping uses stable external references and does not overwrite canonical Patient/CRM identity;
- FHIR mappings are adapters; internal schema is not forced to mirror external resources;
- inbound updates are idempotent and authorized;
- PHI is minimized in logs/events;
- tenant isolation remains green.

## 12. Release Hardening Gate

Before real patient data or a production release after migration batches, run the full relevant regression suite, including at minimum:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run build
npm run test:smoke
npm run test:roles
npm run test:actions
npm run test:tenant
npm run test:security
npm run test:security-runtime
npm run test:hardening
npm run test:billing
npm run test:billing-concurrency
npm run test:patient-files
npm run test:data-integrity
npm run test:compensation
npm run test:source-commission
npm run browser:qa
npm run go-live:check
```

Also run the self-host packaging and restore drill in `docs/OPERATIONS.md` when migrations, storage, deployment, or infrastructure changed.

## 13. High-Risk Manual Regression Checks

Automated tests do not replace these targeted observations when the corresponding workflow changes:

- Journey opens the intended patient and preserves chronological clinical history.
- Odontogram FDI mapping, stage independence, revision conflict behavior, multi-selection, and treatment-target separation remain intact.
- Billing receipts, allocations, partial invoices, refunds and unallocated credit reconcile after refresh and concurrent operations.
- Protected patient files cannot be fetched by another organization, inaccessible clinic, or unrelated patient portal account.
- Staff/role administration cannot demote/disable protected equal-or-higher authority incorrectly and preserves at least one active owner.
- Patient portal shows only the linked patient's data and future actionable appointments.
- Vietnamese operational copy renders without mojibake and critical layouts do not horizontally overflow at supported mobile widths.

## 14. Audit Loop Record

Do not create a permanent session log. For each phase/PR, the PR description or commit evidence should state succinctly:

- baseline gates run;
- implementation scope;
- findings discovered;
- fixes applied;
- final gates rerun;
- any advisory explicitly deferred without violating exit criteria.

Git history/PR discussion is the change record. The active docs remain concise sources of current truth.
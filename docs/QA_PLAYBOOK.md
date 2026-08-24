# QA Playbook

Last updated: 2026-08-24

This file defines how architecture/refactor work is proven safe. The authoritative CI sequence is `.github/workflows/ci.yml`; this playbook explains which gates matter and when additional targeted coverage is required.

## Core rule

A refactor is not complete when the new page renders. It is complete only when **one final HEAD** passes the applicable architecture, security, tenant, high-risk domain, browser and workflow regression gates without weakening production behavior.

Do not disable a test to make a migration pass. Fix the implementation or isolate the test harness while preserving the production contract.

## Fast local check

```powershell
npm run encoding:check
npm run typecheck
node scripts/agent-module-audit.mjs
npm run test:security
node scripts/agent-health-check.mjs
```

Run targeted tests for the area being changed before starting the full gate.

## Current canonical migration routes

The current route contract in `scripts/qa-route-contract.mjs` is:

```text
/today
/work
/schedule
/care
/patients/[patientId]
/treatment
/patients/[patientId]/treatments/[treatmentServiceId]
/operations
/operations/finance
/employee-app
```

`/patients` is also canonical and is exercised by normal route/browser discovery. `/journey` and `/clinical` are compatibility entries to Patient 360. `/schedule/legacy` is deliberately legacy and must not be treated as a canonical migrated route.

The CI Browser QA enables the full migration set above. Smoke route coverage enables the relevant dynamic/new routes while Today is part of default smoke behavior.

When running manually:

```powershell
$env:SMOKE_MIGRATION_ROUTES = "/work,/schedule,/care,/patients/[patientId],/treatment,/patients/[patientId]/treatments/[treatmentServiceId],/operations,/operations/finance"
$env:BROWSER_QA_MIGRATION_ROUTES = "/today,/work,/schedule,/care,/patients/[patientId],/treatment,/patients/[patientId]/treatments/[treatmentServiceId],/operations,/operations/finance,/employee-app"
npm run test:smoke
npm run browser:qa
```

Dynamic route ids are discovered from canonical links where possible; use the documented QA patient/treatment-service env values only when discovery is unavailable.

## Legacy compatibility route coverage

Until a route is explicitly retired/redirected with parity evidence, keep smoke coverage for compatibility surfaces such as:

```text
/dashboard
/journey
/clinical
/billing
/accounting
/services
/staff
/crm
/inventory
/pharmacy
/forms
/learning
/reports
/settings
/patient-app
```

Do not remove a compatibility gate merely because a new canonical workspace exists. Retirement is part of the phase contract that proves equivalent workflow, authorization and navigation behavior.

## Current full CI contract

Every PR runs the core verification chain. Pull requests additionally run Browser QA and workflow E2E smoke suites.

### Build and architecture

- `npm ci --include=dev --no-audit --no-fund`
- `npm run encoding:check`
- `npm run typecheck`
- `node scripts/agent-module-audit.mjs`
- Prisma migrations + deterministic seed/test users
- `npm run build`
- production server health check
- `node scripts/agent-health-check.mjs`
- `npm run test:smoke`

### Security and data integrity

- `npm run test:security`
- `npm run test:security-runtime`
- `npm run test:tenant`
- `npm run test:billing`
- `npm run test:billing-concurrency`
- `npm run test:actions`
- `npm run test:patient-files`
- `npm run test:data-integrity`

### Browser and workflow regression

On pull requests/scheduled/manual CI:

- `npm run browser:qa`
- `node scripts/clinical-execution-smoke.mjs`
- `node scripts/staff-operations-smoke.mjs`
- `node scripts/finance-einvoice-smoke.mjs`
- `node scripts/einvoice-concurrency-smoke.mjs`
- `node scripts/patient-access-smoke.mjs`

The test harness clears persistent login rate-limit buckets **only under `NODE_ENV=test`** between independent browser suites. Never weaken production auth/rate-limit behavior to fix a CI login collision.

### Packaging

- `docker build -t codexdentist:ci .`

A change that affects self-host packaging should also validate compose/install/backup/restore expectations from `OPERATIONS.md`.

## Architecture migration gate

`agent-module-audit` protects new architecture boundaries under `src/shared`, `src/domains`, `src/features`, `src/workspaces` and canonical migrated routes.

Required properties:

- shared is business-agnostic;
- features do not depend upward on workspaces/app routes;
- workspaces do not depend on app routes;
- migrated routes/features/workspaces do not import `DentalSuite` or `AppViewPage`;
- canonical route pages delegate to workspace-specific composition;
- technical/database/demo diagnostic copy does not leak into workflow UI.

Legacy `src/components`, `src/modules` and much of `src/lib` remain migration territory. Existing legacy behavior is not automatically an architecture failure, but **new dependencies into the legacy shell are failures**.

During Phases 4-8, route-shape strictness may be enabled with:

```powershell
$env:ARCHITECTURE_AUDIT_STRICT_ROUTES = "1"
node scripts/agent-module-audit.mjs
```

Phase 9 exit criteria require strict route delegation to be blocking in CI.

## Gate matrix by change type

| Change type | Minimum targeted gates in addition to core build/architecture |
| --- | --- |
| Shared UI / shell / navigation | Browser QA desktop/mobile, smoke, security when auth/navigation visibility changes. |
| Patient 360 / Journey / clinical | Tenant, actions, patient-files, Browser QA, clinical execution, odontogram/clinical regression below. |
| Treatment progress | Clinical execution smoke, billing/data integrity, tenant/actions; compensation/inventory tests when those contracts change. |
| Patient Access / Schedule / Care | Patient-access smoke, tenant/actions/security, browser QA; preserve transition/concurrency/resource checks. |
| Billing / Finance / E-invoice | Billing + billing concurrency + data integrity + finance/e-invoice + e-invoice concurrency smoke. |
| Staff / earnings / payroll | Staff-operations smoke, tenant/actions, source-commission/compensation tests when affected. |
| Patient files / upload | Patient-files + security + tenant plus browser access checks. |
| Settings / roles / clinics | Roles/actions/tenant/security; verify equal-or-higher role protections and owner preservation. |
| Patient Portal | Security/tenant/actions plus patient-self isolation and terminal-state transitions. |
| Public/self-host/deploy | Docker, host routing, demo behavior and `OPERATIONS.md` packaging/readiness checks. |

## Phase 4 mandatory Patient 360 regression contract

Phase 4 extracts the `PatientJourneyPanel` compatibility island. Extraction must preserve behavior, not merely move JSX.

At minimum verify:

1. Patient directory search and canonical patient links.
2. Patient create/edit stays tenant/clinic scoped and moves to canonical Patients without losing legacy capability.
3. `/patients/[patientId]`, `/journey` and `/clinical` resolve the same authorized patient context during compatibility.
4. Finalized timeline events remain chronological and complete; unfinished clinical notes do not silently become finalized history.
5. Clinical plan/exam actions preserve permission, audit and signing/amendment semantics.
6. Odontogram stages, revisions and treatment-target isolation remain intact.
7. Protected files/forms/prescriptions/pharmacy and authorized financial context serialize only for permitted roles.
8. Billing/Front Desk cannot gain clinical mutation affordances through the new composition.
9. Mobile `390x844` and small-screen clinical dialogs do not horizontally overflow.
10. At Phase-4 exit, `src/workspaces/patients/**` must no longer import `src/modules/journey/PatientJourneyPanel`.

## High-risk invariant checks

### Tenant and permissions

Preserve negative tests:

- Org A cannot list/read/edit Org B patients, invoices, payments or files.
- Tenant subdomain cannot authenticate/reset another tenant's user.
- Clinic-scoped users cannot access records outside allowed clinics.
- Every protected mutation re-checks action permission and scopes the target server-side.
- Patient self-scope uses `portalUserId`, never email.

### Billing / Finance / E-invoice

Verify:

- concurrent receipt/allocation/invoice flows do not overpay or over-allocate;
- partial invoices remain distinct and reconcile to service value;
- void/refund requires role, reason and audit;
- external e-invoice state is auditable and fail-closed without a provider;
- concurrent issue/reconciliation cannot create duplicate provider claims or shared external references;
- Work finance exceptions are derived and clear only after real reconciliation.

### Patient Access

Verify:

- confirmation -> arrival -> in-chair -> completion releases resources correctly;
- incompatible concurrent transitions serialize;
- final states cannot be reopened/regressed;
- cross-clinic patient/provider/chair references are rejected;
- no-show creates Care/Work attention and clears only after a persisted follow-up outcome;
- concurrent recovery is idempotent;
- Billing cannot access Patient Access mutation surfaces.

### Treatment / staff economics

Verify:

- treatment progress cannot regress;
- participant validation and compensation event attribution remain correct;
- material consumption/low-stock behavior remains tied to real progress;
- unresolved referral beneficiary becomes a management Work signal rather than guessed attribution;
- live earnings are not presented as approved/paid payroll.

### Protected files

Verify another organization, inaccessible clinic, patient-self mismatch and unsafe/quarantined/infected states. Content type/extension/signature validation must remain enforced before storage/serving.

## Odontogram / clinical contract

The detailed implementation may be refactored, but these behaviors are invariant:

- standard FDI mapping for permanent and primary teeth;
- `INITIAL`, `CURRENT`, `EXPECTED` are independent stages with revision/history semantics;
- legacy snapshot migration preserves visible data;
- stale revisions conflict rather than overwrite;
- switching stages only clears temporary treatment-target selection, not clinical entries;
- treatment service creation may clear temporary targets but must not mutate any clinical-stage snapshot;
- crown/root/surface targets preserve their clinical meaning;
- missing/implant/prosthetic/bridge states remain structurally valid and undoable;
- multi-tooth selection can be empty, applies grouped clinical actions atomically, and validates bridge span/arch rules;
- clinical roles edit; Front Desk/Billing remain read-only; inaccessible-clinic patients cannot read/write stages.

Any Phase-4 extraction touching odontogram integration must explicitly exercise these behaviors before removing the legacy path.

## Browser QA expectations

Browser QA covers desktop `1440x900` and mobile `390x844` and should fail/review for:

- route/server errors;
- console/network failures caused by the page;
- horizontal overflow;
- broken modal/form layout;
- inaccessible primary controls or missing focus behavior;
- raw enum/technical copy/mojibake;
- canonical links that point back into retired module navigation.

A visual refactor does not justify suppressing a behavioral/browser finding.

## Public and self-host checks

When relevant preserve:

- root/docs/demo/odontogram hostname routing;
- demo organization expiry/isolation and no patient-file upload/outbound notification;
- production health/readiness secret boundaries;
- clean Docker build without local `.env` or database;
- fresh self-host setup creates first owner then locks setup;
- backup produces a valid PostgreSQL dump plus patient-file archive;
- restore/upgrade work follows `OPERATIONS.md`.

## Definition of Done

Before merging a refactor phase:

1. Define the phase contract and exit criteria in active context.
2. Run targeted gates while implementing.
3. Run the complete applicable CI chain on one final HEAD.
4. Audit diff for accidental domain/schema/security changes.
5. Fix findings and repeat until green.
6. Merge only after canonical/compatibility behavior is explicit.
7. Update `PROJECT_CONTEXT.md`, `PRODUCT_ARCHITECTURE.md`, this playbook, or `AGENTS.md` if the merge changes what the next agent should believe.

The correct loop is:

`Understand -> goal -> execute -> audit -> fix -> audit -> merge -> refresh context`

# Codexdentist Canonical Product Context

Last updated: 2026-09-08
Status: ACTIVE / CANONICAL

Current execution status: Phases 0–2 are merged into `main`; Phase 3 payOS/Documenso is complete on the verified integration branch; Phase 4 Orthanc/OHIF and Phase 5 native dental operations are complete in the current continuation branch; Phase 6 is in progress with the optional, disabled-by-default FHIR export slice complete.

> This file replaces every previous product direction, refactor queue, migration-route plan, and architecture context. Git history is an archive, not an active instruction source. Do not revive an older plan merely because it appears in a previous commit, chat, issue, or deleted document.

## 1. Source Of Truth

When instructions disagree, use this order:

1. Current repository code and database constraints for implemented behavior.
2. This file for product direction, architecture, invariants, and phase sequencing.
3. `docs/QA_PLAYBOOK.md` for verification gates.
4. `docs/OPERATIONS.md` for deploy, backup, restore, hosting, and runtime operations.
5. Git history only to understand why something exists; history must not override the active context.

The current baseline is the code on `main` after the August 2026 rollback. Treat that baseline as real implementation state. Previous frontend migration plans are cancelled unless explicitly reintroduced into this file.

## 2. Product Definition

Codexdentist is an open-source, all-in-one dental clinic operating system designed first for Viet Nam and for small/medium clinics that need practical self-hosting.

Primary product goals:

- One coherent dental operating system rather than a collection of loosely connected modules.
- Safe multi-clinic and multi-tenant operation.
- Strong clinical Journey/odontogram workflow.
- Correct billing and financial reconciliation.
- Protected patient files and auditable sensitive actions.
- Simple self-host deployment for a clinic while allowing optional external services when they add clear value.
- Vietnamese-first operational UX; architecture and infrastructure details must not leak into normal staff workflow copy.

PostgreSQL remains the canonical transactional store for Codexdentist core business state.

## 3. Non-Negotiable Invariants

These rules survive every refactor and integration.

### Tenant and authorization

- `Organization` is the canonical tenant boundary.
- Business data is scoped by `organizationId` server-side.
- Clinic-owned data must additionally respect the actor's accessible clinic IDs.
- Mutation authorization is enforced on the server. UI visibility is never authorization.
- Patient portal identity is based on the explicit patient-to-user relation, never matching by email.
- Refactors must preserve negative cross-tenant tests.

### Clinical and Journey

- Journey remains the patient-centered longitudinal clinical workspace and timeline.
- Odontogram uses standard FDI codes and versioned snapshots with independent clinical stages.
- Temporary treatment selection must remain separate from persisted clinical chart state.
- Clinical write permissions, revision conflict handling, immutable history, and tenant/clinic isolation must not weaken.
- Refactoring presentation code must not opportunistically redesign clinical semantics.

### Billing

- Receipt collection, allocation, invoice issuance, refund/void, credit/unallocated balance, and service progress semantics remain separate concepts.
- Ledger mutations that depend on current balances remain transactionally safe; existing Serializable/concurrency guarantees and database constraints are preserved.
- Partial invoices are not merged after issuance.
- External payment providers may request or report a payment, but they never write Codexdentist billing tables directly.

### Patient files and PHI

- Patient files are protected records, never public assets.
- Every read is authorized by session, tenant, clinic, and linked patient rules as applicable.
- Upload validation remains content-aware and rejects unsafe active payloads.
- New file workflows must use a recoverable lifecycle so an object-store write cannot silently create unmanaged PHI when a database transaction fails.
- Logs, outbox payloads, integration metadata, and audit records must minimize PHI/PII.

### Data preservation

- No reset, reseed, truncate, destructive migration, or bulk deletion of real operational data without explicit user approval and a verified backup/restore path.
- A refactor is not permission to change business records.

## 4. Architecture Target

Codexdentist stays a modular monolith for its canonical dental core. Do not split Patient, Journey, Billing, Scheduling, or core Operations into network microservices merely to achieve modularity.

Target source layers:

```text
src/
├── app/              # Next.js routes, Server Actions, route handlers, composition
├── shared/           # business-agnostic UI/types/utilities
├── domains/          # business rules, domain types, domain events
├── features/         # application use-cases: commands, queries, policies, ports
├── infrastructure/   # Prisma/storage/crypto/jobs/audit implementations
├── integrations/     # external provider adapters and webhook adapters
├── workspaces/       # staff/patient UI composition
├── components/       # legacy migration territory
├── modules/          # legacy migration territory
└── lib/              # legacy/general technical code; migrate deliberately
```

This is a target, not a claim that the baseline already has every directory.

### Dependency direction

- `shared` is business-agnostic and cannot depend on higher business/UI layers.
- `domains` contains business meaning and must not depend on Next.js, Prisma, concrete storage, external providers, app routes, or workspace UI.
- `features` orchestrates domain use-cases and authorization/policy contracts. It must not depend on app routes, workspaces, or concrete external providers.
- `infrastructure` implements technical ports for persistence/storage/crypto/jobs/audit. It must not own business policy or UI composition.
- `integrations` adapts third-party systems to application contracts. It must not bypass application commands to mutate canonical domain tables directly.
- `workspaces` compose UI from features/domain read contracts; they must not call Prisma, object storage, or provider SDKs directly.
- `app` is transport/composition. Server Actions and route handlers should parse/authenticate/dispatch/map responses rather than contain duplicated domain business logic.

Legacy `src/components`, `src/modules`, and broad `src/lib` code are migration territory. Do not perform a rewrite solely to make paths look clean. Move code when a bounded use-case is being changed and can be verified behind the gates below.

## 5. Canonical Bounded Contexts

Use a small number of meaningful contexts rather than one module per screen:

- **Identity**: Organization, Clinic, User, role assignments, authorization policy.
- **Patient**: patient identity/profile, portal association and patient-scoped metadata.
- **Scheduling**: appointments, resources, calendar workflow.
- **Clinical**: Journey, odontogram, exams, plans, treatment services and clinical progression.
- **Revenue**: receipts, allocations, invoices, refunds, balances and accounting projections.
- **Operations**: service catalog, inventory, pharmacy, assets, lab and sterilization capabilities.
- **Workforce**: staff profile, compensation, payroll.
- **Engagement**: CRM, consent, communication and notification orchestration.
- **Imaging**: imaging-study references and authorization around external DICOM/PACS systems.
- **Interoperability**: external representations such as FHIR; never the internal source of truth.

Journey may present events from multiple contexts but does not need to own every underlying table.

## 6. Application Boundary

Business mutations must become reusable application commands/use-cases instead of living only inside Server Actions.

Target flow:

```text
Server Action ─┐
REST/API       ├──> Application Command ──> Domain/Policy ──> Repository Port
Webhook       │
Job/CLI ──────┘
```

Examples of commands that should have one canonical implementation:

- record receipt
- allocate receipt
- issue invoice
- refund/void receipt
- save/finalize clinical state
- attach/commit patient file
- schedule/reschedule/cancel appointment

Transport code may call a command; it must not maintain a second copy of the business rules.

## 7. Integration Architecture

External repositories and services are replaceable adapters or sidecars. They do not become the Codexdentist canonical database.

Before adding multiple providers, establish these concepts:

- `IntegrationConnection`: tenant/clinic provider configuration and capabilities.
- `ExternalReference`: stable mapping between internal and external entity IDs.
- `IntegrationInbox`: verified, idempotent receipt and processing state for external events/webhooks.
- `IntegrationOutbox`: domain/application events persisted with the canonical transaction and dispatched asynchronously/retryably.

Rules:

- Webhook verification happens before business processing.
- Duplicate external event IDs are idempotent.
- Retry/backoff is centralized rather than reimplemented per module.
- Provider failure must not roll back a successfully committed unrelated core transaction.
- Outbox payloads should carry IDs/minimal metadata rather than unnecessary PHI.
- Provider adapters invoke application commands; they do not import Prisma to write core domain records.

### Preferred integration roles

- **payOS**: payment-link/VietQR provider feeding Revenue commands.
- **Documenso**: optional signing engine for consent/document ceremony; Codexdentist remains owner of patient/consent/file/audit state.
- **Orthanc + OHIF**: optional DICOM/PACS + viewer sidecar; Codexdentist stores authorized study references and metadata, not DICOM blobs in PostgreSQL.
- **Notification provider/Novu**: optional implementation behind a Codexdentist notification abstraction.
- **Chatwoot**: optional conversation system; Codexdentist remains Patient/CRM source of truth.
- **FHIR/Medplum**: optional interoperability adapter; FHIR is an external representation, not the internal domain model.

Large sidecars must be opt-in deployment profiles, not mandatory dependencies for a small self-host clinic.

## 8. Patient File Lifecycle Target

New/changed patient-file workflows should converge on a recoverable lifecycle:

```text
STAGED -> COMMITTED
   |          |
   +------> GC_PENDING -> deleted
```

A staged object has enough metadata/checksum to be reconciled. Only a committed object is treated as a normal patient record. Failed/expired staged objects are discoverable and garbage-collected through an auditable job. Existing protected-file authorization remains mandatory throughout the migration.

## 9. Phase Execution Protocol

Every phase follows the same closed-loop process. A phase is not complete when code is merely written.

1. **Baseline**: record the relevant current behavior and run the phase's pre-change gates.
2. **Implement**: make the smallest coherent change that advances the phase objective.
3. **Static audit**: typecheck, encoding, architecture boundary checks, schema/migration review, and focused source review.
4. **Runtime/domain audit**: run required security, tenant, billing, file, integration, smoke, browser, or data-integrity tests for the touched surface.
5. **Classify findings**: blocker, high, medium, advisory.
6. **Fix**: resolve every blocker/high finding and every medium finding that violates the phase exit criteria.
7. **Re-audit**: repeat the same failing gates and relevant regression suite.
8. **Repeat** steps 5-7 until exit criteria are satisfied with zero unresolved blockers/high findings.
9. **Close phase** only when evidence satisfies all exit criteria. Do not weaken a gate to make a phase pass.

If a test exposes an existing baseline defect unrelated to the change, document it explicitly and either fix it safely in the phase or keep the phase open. Do not silently suppress it.

## 10. Phased Plan And Exit Criteria

### Phase 0 — Reset Context And Enforcement

**Objective**

Remove stale product/refactor instructions and make repo tooling enforce only the active architecture direction.

**Implementation scope**

- Replace old product context with this canonical context.
- Update agent guidance and QA playbook to this phase/gate model.
- Remove retired migration-route assumptions and legacy target names from architecture audit tooling.
- Teach architecture audit about `infrastructure` and `integrations`.
- Remove obsolete deploy-target references that can be mistaken for current product direction while preserving useful operational safety guidance.

**Exit criteria**

- Active docs contain no previous migration-route queue as an instruction.
- `agent-module-audit` contains no hard-coded old migration routes or `DentalSuite/AppViewPage` migration policy.
- New architecture layers have enforceable dependency rules.
- `encoding:check`, `typecheck`, and `agent:audit` pass on the branch.
- Documentation and tooling agree on the same architecture direction.

### Phase 1 — Extract The Application Boundary

**Objective**

Move reusable business mutation logic out of transport/UI code without changing business semantics.

**Order**

1. Revenue/Billing commands first.
2. Journey patient-file/comment/finalization commands.
3. Patient commands.
4. Scheduling commands.

**Exit criteria**

- Touched Server Actions/route handlers are thin transport adapters.
- Each migrated mutation has one canonical application implementation usable by UI, webhook, job, or API.
- Tenant/clinic and action permissions are enforced at the application boundary or an equally mandatory server boundary.
- No duplicated billing/clinical mutation implementation is introduced.
- Existing billing concurrency, tenant, security, data-integrity, Journey/file tests for touched areas pass.

### Phase 2 — Integration Substrate And File Consistency

**Objective**

Create safe primitives needed by all external integrations and eliminate unmanaged-object failure modes in new file workflows.

**Implementation scope**

- Add integration connection, external reference, inbox and outbox persistence.
- Add idempotency constraints and processing/retry state.
- Add an outbox dispatcher contract and auditable retry behavior.
- Introduce staged/committed/GC lifecycle for new or migrated patient-file writes.

**Exit criteria**

- Duplicate webhook/event delivery cannot create duplicate domain mutations.
- A committed domain mutation plus outbox event is atomic where required.
- Provider outage/retry does not corrupt canonical business state.
- Failed DB/file sequences leave a discoverable staged object rather than unmanaged PHI.
- Tenant/security/patient-file/data-integrity tests and new inbox/outbox/file-reconciliation tests pass.

### Phase 3 — First Production Integrations: payOS And Documenso — COMPLETE

**Objective**

Prove the integration substrate with high-value providers without coupling provider data models to core domains.

**payOS exit criteria**

- Payment-link creation is tenant/clinic scoped.
- Webhook signature verification occurs before inbox acceptance/processing.
- Duplicate, delayed, and reordered webhook scenarios are idempotent.
- Settlement invokes Revenue application commands; provider code does not write billing tables directly.
- Billing concurrency/reconciliation remains green.

**Documenso exit criteria**

- Consent/form ownership remains in Codexdentist.
- Signing request uses minimized external data.
- Signed result returns through verified/idempotent integration processing.
- Signed PDF enters the protected staged/committed patient-file lifecycle.
- Consent, file, Journey/timeline and audit state reconcile after retry/failure tests.

The verified Phase 3 branch passed CI run #337 on 2026-09-02 with zero unresolved Blocker/High findings. Its merge remains a repository coordination step; Phase 3 implementation is not an open design task.

### Phase 4 — Imaging: Orthanc And OHIF — COMPLETE

**Objective**

Add production-grade DICOM/PACS viewing without turning DICOM storage into Codexdentist database state.

**Exit criteria**

- Codexdentist stores tenant/clinic/patient-scoped imaging references and stable external IDs.
- DICOM blobs remain in Orthanc-managed storage.
- Viewing requires Codexdentist authorization and cannot cross tenant/clinic boundaries.
- Patient mapping uses stable identifiers, not name/email heuristics.
- Backup/restore and unavailable-PACS behavior are documented and tested.
- OHIF access path works at desktop/mobile widths required by the supported workflow.

Implementation evidence:

- `ImagingStudy` stores organization/clinic/patient scope, Orthanc study and patient IDs, StudyInstanceUID, normalized modality/date metadata, and availability state; it has no DICOM blob or pixel-data field.
- Orthanc transport is an isolated provider adapter. It verifies stable study IDs, minimizes DICOM metadata, rejects traversal, maps PACS outages to actionable errors, and never imports Prisma or writes canonical tables.
- Application commands enforce tenant/clinic authorization for linking, listing, and viewer access. OHIF receives only the StudyInstanceUID through a configured base URL; missing configuration fails closed.
- `/imaging`, the imaging API routes, the migration, architecture gate, provider smoke, and tenant/clinic negative smoke are covered by the Phase 4 verification loop.
- Phase 4 re-audit passed encoding, typecheck, canonical architecture audit, Prisma validation, production build, provider smoke, and scoped database smoke with zero unresolved Blocker/High findings.

### Phase 5 — Native Dental Operations Gaps — COMPLETE

**Objective**

Implement dental-specific gaps natively instead of importing another PMS architecture.

**Initial priority**

- Lab case/order workflow.
- Sterilization cycle/instrument traceability where operationally justified.

Implementation evidence:

- Lab case/order workflow is implemented as the native `LabCase` bounded model with canonical Patient/Clinic/TreatmentService references, ordered status transitions (`DRAFT` → `SENT` → `IN_PROGRESS` → `READY` → `DELIVERED`), cancellation path, server-side scope/permissions, audit records, API routes, and a responsive `/lab` view.
- Sterilization traceability is implemented with native `SterilizationInstrument`, `SterilizationCycle`, and cycle-membership models, ordered run/pass/fail/release transitions, clinic scope, audit records, API routes, and a responsive `/sterilization` view.
- Phase 5 re-audit passed Prisma validation, typecheck, architecture audit, Lab and Sterilization tenant/workflow smoke, and production build with zero unresolved Blocker/High findings.

**Exit criteria**

- New models follow canonical tenant/clinic/audit rules.
- No second Patient/Appointment/Billing source of truth is introduced.
- Workflows integrate through existing Clinical/Operations contexts and Journey events where useful.
- Data-integrity, tenant, permissions, smoke and browser checks pass.

### Phase 6 — Optional Communication And Interoperability

**Objective**

Add replaceable communication and standards integrations only after core boundaries are stable.

**Exit criteria**

- Notification providers sit behind a Codexdentist abstraction.
- Chatwoot, if enabled, owns conversations but not canonical Patient/CRM identity.
- FHIR/Medplum mappings are anti-corruption adapters and do not reshape the internal schema merely to mirror FHIR resources.
- Optional sidecars can be disabled without breaking the core clinic workflow.
- PHI minimization, webhook idempotency, auditability and tenant isolation are verified.

Current Phase 6 progress:

- The optional FHIR Patient representation is implemented as a pure adapter behind `FHIR_EXPORT_ENABLED=false` by default. The authenticated route uses canonical patient scope and exposes only demographics/contact fields required for the external representation; it does not accept inbound writes or make FHIR the source of truth.
- Existing notification delivery already sits behind the Codexdentist notification abstraction and supports disabled delivery. Chatwoot/provider-backed communication and inbound interoperability remain open slices before Phase 6 can close.

### Phase 7 — Release Hardening

**Objective**

Prove that the refactored/integrated system remains safe to deploy, upgrade, back up and restore.

**Exit criteria**

- Full go-live gate passes.
- Self-host compose/build gate passes.
- Clean install and upgrade path are verified.
- Backup plus disposable restore drill passes after migration batches.
- No unresolved blocker/high architecture, security, tenant, billing, file-integrity or integration finding remains.

## 11. Architecture Guardrails

These are review-blocking rules:

- No external provider directly mutates canonical Patient, Journey, Billing, Scheduling, or protected-file business state through Prisma.
- No other dental PMS is merged wholesale into Codexdentist core.
- No external provider becomes source of truth for Patient, Journey, Billing, or core authorization.
- No mandatory deployment bundle of every optional platform/sidecar.
- No PHI-heavy outbox/log payload when a stable internal ID is enough.
- No UI-only authorization.
- No route/UI refactor is allowed to weaken tenant, billing, Journey, protected-file, payroll/compensation, or audit invariants.
- No broad rewrite when a strangler migration can preserve production behavior and test coverage.
- Do not add a new architecture concept without adding or updating an enforceable audit/test for it when practical.

## 12. Definition Of Done For Any Phase

A phase is complete only when all of the following are true:

- Its objective is demonstrably implemented, not merely documented.
- Every exit criterion has objective evidence.
- Required tests pass without disabling safeguards.
- Static architecture audit reports no blocker/high violation in new architecture code.
- Relevant negative tenant/security tests remain green.
- Data migrations are reversible or have a verified restore path.
- Operational docs are updated when deployment/storage/jobs change.
- Re-audit after fixes is green.

Until then, the phase remains open.

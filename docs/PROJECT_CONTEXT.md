# Project Context

Last updated: 2026-08-24

This file answers four questions for every contributor or coding agent:

1. What product are we building?
2. What architecture is true on current `main`?
3. Which business and safety invariants must not change accidentally?
4. What work comes next, in what order, and what proves each phase is complete?

For layer rules read `PRODUCT_ARCHITECTURE.md`. For verification read `QA_PLAYBOOK.md`. For deployment/self-host operations read `OPERATIONS.md`.

## Current baseline

The workflow-first refactor is integrated through **Phase 4 — Patient 360 Core Extraction**. The completed sequence is:

- `#20` workflow-first Dental OS shell;
- `#21` Patient 360 route/read-model shell;
- `#22` Treatment Case workspace;
- `#23` clinical execution loop;
- `#24` unified earnings and staff operations;
- `#25` Finance / E-invoice operations;
- `#26` Patient Access / Front Desk loop;
- `#27` post-Phase-3 context/architecture reset;
- `#29` native Patient 360 core extraction.

New architecture work must branch from the latest `main`, not from those historical implementation branches.

The default next architecture phase is **Phase 5 — Care / CRM Convergence**, tracked by issue **#30**.

## Product direction

Codexdentist is an open-source, all-in-one dental clinic operating system for Viet Nam, focused first on small and medium clinics that can self-host on a local PC, server, or NAS. Hosted Codexdentist provides the public product/docs experience and isolated demo workspaces; the long-term direction is a community-maintained multi-clinic Dental OS with optional hosted services.

The staff product is **workflow-first, not module-first**. Deep domain capability remains, but the primary interface should match how clinic staff work rather than mirror backend tables/modules.

Primary staff workspaces are:

1. `Today` — current operational attention.
2. `Schedule` — booking, confirmation, arrival, chair/provider dispatch.
3. `Patients` — Patient 360 and longitudinal patient context.
4. `Treatment` — Treatment Cases and execution progress.
5. `Work` — unified operational exceptions/tasks/signals.
6. `Care` — leads, follow-up, recall, no-show recovery and communication outcomes.
7. `Operations` — staff, finance, inventory, reports.
8. `Settings` — clinic configuration, roles, services, compensation, templates, integrations, audit.

A domain capability does not automatically deserve a primary navigation item.

## Runtime and hosting context

- Local/self-host app: `http://127.0.0.1:3000` by default.
- Self-host distribution uses `compose.selfhost.yml`, `install.ps1`, `install.sh`, and `scripts/codexdentist.mjs`.
- Public product/docs live on `codexdentist.com`.
- Public demo lives on `demo.codexdentist.com` and uses isolated expiring organizations.
- Public standalone odontogram lives on `odontogram.codexdentist.com`.
- `app.codexdentist.com` is the neutral hosted application host.
- Hosted production deploys must preserve environment configuration, PostgreSQL data, and protected-file storage. Follow `OPERATIONS.md`; do not improvise production reset/reseed flows.

## Architecture after Phase 4

New architecture follows:

`route -> authenticated/scoped loader or read model -> workspace -> feature/server action -> existing domain/persistence contract`

The new architecture lives primarily under:

- `src/shared/**` — business-agnostic presentation primitives/contracts;
- `src/features/**` — cohesive workflow capability, read-model adapters, server actions;
- `src/workspaces/**` — route-level workflow composition and UI;
- `src/domains/**` — reserved for stable domain contracts when extraction genuinely benefits from it; not a mandatory destination for legacy files.

`src/lib/**`, `src/modules/**`, `src/components/DentalSuite.tsx`, and `src/app/(app)/view-page.tsx` remain migration territory. They contain valuable tested behavior and must be extracted incrementally rather than rewritten for folder purity.

### Canonical / migrated surfaces

| Product surface | Canonical route(s) | Current state |
| --- | --- | --- |
| Today | `/today` | Migrated workspace. `/dashboard` remains compatibility entry/redirect. |
| Work | `/work` | Migrated unified operational queue with derived domain signals. |
| Schedule | `/schedule` | Migrated Patient Access workspace. `/schedule/legacy` preserves the old dispatch surface temporarily. |
| Care | `/care` | Migrated follow-up/no-show workspace; lead intake/conversion still needs CRM convergence in Phase 5. |
| Patients | `/patients`, `/patients/[patientId]` | **Native Patient 360**: directory/intake, demographics, consent/source governance, clinical/plan, odontogram, treatment services and derived longitudinal timeline. No `PatientJourneyPanel` dependency. |
| Journey / Clinical | `/journey`, `/clinical` | Compatibility entries that resolve the same authorized patient into canonical Patient 360. |
| Patient management | `/patient-management` | Retired module entry; redirects to canonical `/patients`. |
| Treatment | `/treatment`, `/patients/[patientId]/treatments/[treatmentServiceId]` | Migrated Treatment Case directory/case and clinical execution. |
| Operations | `/operations` | Migrated staff-operations workspace; workforce/inventory/reports convergence is still pending. |
| Finance | `/operations/finance` | Migrated finance/e-invoice operational workspace; `/billing` and `/accounting` remain compatibility module routes. |
| Employee self-service | `/employee-app` | Migrated staff self-service workspace. |
| Settings | `/settings` | Still legacy `AppViewPage -> DentalSuite`; canonical destination known, migration pending. |

The migration QA contract is encoded in `scripts/qa-route-contract.mjs`, the general architecture guard in `scripts/agent-module-audit.mjs`, and the Patient 360 extraction boundary in `scripts/patient-360-architecture-audit.mjs`.

## Native Patient 360 ownership

Phase 4 changed ownership, not high-risk domain semantics.

### Workspace composition

`src/workspaces/patients/**` now owns the Patient 360 presentation:

- patient directory/search and intake;
- profile/demographics, consent and lead-source governance;
- clinical exam/note and treatment-plan presentation;
- odontogram and treatment-service composition;
- longitudinal timeline derived from appointments, finalized clinical history, treatment plans/progress, invoices/receipts, prescriptions, forms, protected files, Care/CRM activity and Journey comments.

The timeline is a **read-model composition**, not a new persistence source. Do not create duplicate timeline/task rows just to mirror existing domain state.

### Server mutation ownership

Patient 360 mutations live under:

- `src/features/patient-360/server/patient-actions.ts`;
- `src/features/patient-360/server/clinical-actions.ts`;
- `src/features/patient-360/server/journey-actions.ts`;
- `src/features/patient-360/server/odontogram-actions.ts`;
- `src/features/patient-360/server/patient-file-actions.ts`.

Old route action files under `/patients`, `/clinical`, `/journey`, Journey odontogram and `/patient-files` are thin async compatibility forwarding adapters. Do not put new business behavior back into them.

`PatientOdontogramEditor` binds directly to the Patient 360 odontogram feature actions. This preserves its existing debounce, revision-conflict, reset/copy-stage and history contract while removing the transitive workspace -> Journey-route dependency.

### Frozen Patient Journey monolith

`src/modules/journey/PatientJourneyPanel.tsx` is no longer part of canonical Patient 360 composition. Treat it as frozen legacy/migration source only. Do not import it from new workspaces/features or add new product capability to it.

## Remaining legacy frontier

The workflow migration is substantial, but the legacy shell is not extinct.

Important remaining migration debt:

- `/crm` and `src/modules/crm/CrmPanel.tsx` still own lead/create/convert capability not yet converged into Care.
- `/billing` and `/accounting` still own large compatibility surfaces despite canonical Finance.
- `/staff` still owns legacy management/payroll capability despite Operations and Employee self-service.
- `/inventory` and `/reports` are not yet native Operations surfaces.
- `/settings` and `/services` remain module-first configuration surfaces.
- `/forms` and `/pharmacy` remain standalone clinical-support surfaces even though their patient context can already appear in Patient 360.
- `/patient-app` remains a legacy patient-facing application.
- `src/components/DentalSuite.tsx`, `AppViewPage`, many `src/modules/**` files and global/legacy styling remain migration territory.

New work must **shrink this frontier, never expand it**.

## Completed refactor phases

### Phase 0/1 — Workflow foundation (`#20`, `#21`, `#22`)

Completed:

- workflow-first shell and workspace switcher;
- canonical Today/Work;
- Patient 360 route/read-model shell;
- canonical Treatment Case directory and case route;
- architecture guardrails preventing migrated code from depending on `DentalSuite` / `AppViewPage`.

### Clinical execution (`#23`)

Completed:

- Treatment Case records real service progress;
- participant validation, compensation accrual, material consumption and audit behavior preserved;
- stale clinical/treatment state becomes derived Work signal;
- Billing stays read-only to clinical context/mutation.

### Staff operations (`#24`)

Completed:

- unified live earnings read model;
- canonical Operations staff view;
- employee self-service workspace;
- attendance/leave/referral/payroll exceptions feed Work;
- persisted payroll finalization semantics were not rewritten.

### Phase 2 — Finance / E-invoice (`#25`)

Completed operational loop:

`Treatment service -> Collection -> Receipt allocation -> Invoice -> E-invoice state -> Reconciliation -> Work`

The provider adapter fails closed when unconfigured, E-invoice state is auditable/append-only, external reconciliation is explicit, and billing/concurrency semantics remain intact.

### Phase 3 — Patient Access (`#26`)

Completed operational loop:

`Booking -> Confirmation -> Arrival -> Chair dispatch -> Completed / No-show -> Patient 360 / Care -> Work`

The server enforces status transitions, resource serialization, organization/clinic scope, provider/chair lifecycle and no-show recovery. No-show signals clear only after a real CRM follow-up outcome is recorded.

### Phase 4 — Patient 360 Core Extraction (`#29`)

Completed:

- removed `PatientJourneyPanel` from canonical Patient 360 composition;
- made `/patients` own directory/search, patient intake, demographics edit, consent and lead-source governance;
- built native Patient 360 profile, clinical/plan, odontogram/treatment-service and longitudinal timeline sections;
- moved patient/clinical/journey/odontogram/patient-file mutations below the workspace into `src/features/patient-360/server/**` while keeping route actions as compatibility forwarders;
- preserved the existing odontogram editor behavior but bound it to feature actions directly;
- converted `/patient-management` to a compatibility redirect;
- kept `/journey` and `/clinical` as compatibility entries into the same scoped Patient 360 context;
- added a Phase-4-specific architecture audit and end-to-end smoke covering canonical intake/edit, audited clinical/timeline writes, compatibility routing and Billing read-only behavior;
- preserved clinical signing/history, odontogram revision/stage, protected-file, treatment-progress, tenant/clinic and role boundaries without Prisma-schema redesign.

## Non-negotiable business and safety invariants

The refactor changes composition and information architecture. It does **not** grant permission to redesign high-risk domain semantics opportunistically.

### Tenant, auth and roles

- `Organization` is the canonical tenant/chain boundary.
- Business data is scoped by `organizationId`; clinic data must also respect accessible clinic ids.
- Route access lives in `src/lib/permissions.ts`; mutation permission lives in `src/lib/actions/permissions.ts` and feature/server actions.
- UI visibility is presentation only, never authorization.
- Users can hold multiple active role assignments; staff title is not an authorization role.
- Tenant-host login/reset must never cross tenant boundaries.
- Patient Portal authorization is based on `Patient.portalUserId -> User.id`, never email matching.

### Clinical, Patient 360 and odontogram

- Patient 360 is the canonical longitudinal patient context.
- `/journey` and `/clinical` are compatibility entries, not alternate product implementations.
- Timeline history, clinical signing/amendment, patient files and odontogram revision behavior remain auditable.
- Odontogram uses FDI codes and independent `INITIAL`, `CURRENT`, `EXPECTED` stages with revision/history semantics.
- Treatment-target selection must never overwrite clinical odontogram snapshots.
- Treatment progress cannot regress and must preserve participant, inventory, compensation and audit invariants.
- Billing/Front Desk must not gain clinical mutation rights through workspace composition.
- Protected files remain authorization-scoped records even when surfaced in the Patient 360 timeline.

### Billing and E-invoice

- Ledger mutations use retryable PostgreSQL `Serializable` transactions; calculation reads used by a write belong in the same transaction.
- Receipt collection, allocation and invoice issuance are distinct concepts.
- Partial invoices remain separate issued records; overpayment remains unapplied/advance balance rather than inventing invoice value.
- Existing reconciliation/database constraints and tenant ownership checks remain in force.
- E-invoice provider operations fail closed when no provider is configured; do not simulate provider success.
- External reconciliation is explicit/audited; E-invoice references cannot be shared across invoices.

### Files and PHI/PII

- Patient files are protected records, never public assets.
- File serving requires session, role, organization, clinic and linked-patient authorization.
- Uploads validate size, declared MIME, extension and content signature; active HTML/SVG payloads remain rejected.
- Demo workspaces cannot upload patient files or send outbound notifications.

### Staff, payroll and compensation

- Treatment-progress compensation accrues per positive progress event and keeps participant attribution/audit.
- Source commission is based on collected cash and remains separate from clinical compensation.
- Live/estimated earnings are not the same object as approved/paid payroll runs.
- Do not invent payroll tax/social-insurance automation as part of architecture cleanup.

### Patient Access and Care

- Appointment/provider/chair claims remain server-serialized and clinic-scoped.
- Invalid status regression and reopening final appointment states remain rejected.
- BUSY resource state is released only according to the real in-chair usage contract.
- No-show recovery clears only after a persisted follow-up outcome, not after merely viewing Care/Work.
- Phase 5 must preserve these Patient Access rules while converging CRM lead/follow-up workflows into Care.

### Work / Today signals

Operational exceptions should normally be **derived from domain state** and adapted into Work/Today. Do not persist duplicate task rows only to mirror another source of truth.

## Roadmap after Phase 4

Security or production-data incidents can preempt this roadmap. Otherwise, architecture work should proceed in this order.

### Phase 5 — Care / CRM Convergence — NEXT (`#30`)

**Why next:** `/care` owns no-show/follow-up operations, but lead intake, conversion and parts of CRM remain in the legacy module. This splits one patient-acquisition/recovery workflow across two architectures.

**Goal:** make `/care` own:

`Lead intake -> qualification/follow-up -> conversion to Patient -> recall / communication outcome / no-show recovery -> Patient 360 -> Today / Work`

Scope:

- lead intake and lead-to-patient conversion;
- recall/follow-up queues and communication outcomes;
- Phase-3 no-show recovery;
- feature/server ownership for new CRM mutations/read models;
- derived Today/Work signals without duplicate persistent task state;
- compatibility retirement of `/crm` only after parity.

Exit criteria:

- core lead/create/convert/follow-up workflows no longer require `DentalSuite` / legacy CRM rendering;
- tenant/clinic, patient-source, consent, notification and action-permission rules stay server enforced;
- `/crm` compatibility behavior is explicit and tested;
- targeted Care/CRM conversion/follow-up/no-show smoke and Patient Access regressions pass on one final HEAD.

Detailed work contract: GitHub issue #30.

### Phase 6 — Finance Surface Convergence

Converge legacy Billing and Accounting into `/operations/finance` without rewriting ledger semantics.

Exit requires those primary workflows to stop depending on `AppViewPage -> DentalSuite`, while billing, concurrency, reconciliation and E-invoice gates remain green.

### Phase 7 — Workforce Management Convergence

Converge remaining Staff/Payroll management into Operations while preserving live earnings vs persisted PayrollRun separation, compensation attribution, source commission and management permissions.

### Phase 8 — Inventory & Reporting Operations

Move Inventory and Reports into Operations while preserving stock/material effects, clinic scope, role boundaries and data integrity.

### Phase 9 — Settings & Service Catalog

Rebuild Settings natively for clinic configuration, roles, services/catalog, compensation policies, templates, integrations and audit. Converge `/services` only with treatment-step compatibility proven.

### Phase 10 — Clinical Support Convergence

Move Forms/consent and Pharmacy/prescription workflows into Patient 360/clinical context while keeping standalone compatibility routes until parity. Phase 4 already makes their patient state visible in the longitudinal timeline; Phase 10 migrates their primary workflows.

### Phase 11 — Patient Portal / External Experience

Rebuild `/patient-app` after staff core stabilizes. Preserve strict `portalUserId` patient-self authorization, terminal-state rules, protected files and consent boundaries.

### Phase 12 — Legacy Shell Extinction and Architecture Freeze

Remove the last protected-route dependencies on `AppViewPage` / `DentalSuite`, retire extracted compatibility islands and make strict route architecture delegation blocking in CI.

Exit criteria:

- no protected staff workflow route imports/renders `AppViewPage` / `DentalSuite`;
- no new product behavior lives in frozen legacy modules;
- strict architecture audit passes on every canonical workspace route;
- full CI and Docker build are green.

### Phase 13 — Productization, Knowledge and Public Surface

Only after staff architecture stabilizes:

- recreate public product storytelling from current `main`, not stale design branches;
- decide Learning/Community/Knowledge/RAG direction;
- improve release notes, upgrade compatibility and support intake;
- expand community beta/self-host validation.

## Parallel maintenance lane

Maintenance is not a numbered architecture phase:

- dependency updates should be rebased/reviewed separately and pass the same safety gates;
- critical security fixes may preempt any phase;
- backup/restore, Windows/Linux/NAS and deployment work follow `OPERATIONS.md`;
- public landing experiments should not transplant branches based on an obsolete app tree.

## Agent decision rules

When a task is ambiguous:

1. Protect production/security/data invariants first.
2. If it is architecture/refactor work and no phase is specified, continue **Phase 5 / issue #30**.
3. Extract behavior from legacy code; do not rewrite stable business logic merely to change folders.
4. Do not create a new primary workspace unless product architecture is explicitly changed.
5. Do not retire a compatibility route until canonical parity and QA evidence exist.
6. Do not weaken production behavior or a safety test to make a migration pass; fix implementation or isolate the test harness.
7. Update this file when the current phase, canonical route, invariant or next-phase decision changes.

## Project-level Definition of Done for a phase

A phase is complete only when one final HEAD satisfies its contract and applicable full verification chain:

- encoding, TypeScript, architecture audit and production build;
- route/health smoke;
- security, tenant isolation, action permissions, protected patient files and data integrity;
- billing/concurrency or other high-risk domain gates where applicable;
- desktop/mobile Browser QA;
- targeted workflow regression smoke for the phase plus adjacent established regressions;
- Docker production image build;
- diff audit confirms no accidental schema/domain/security redesign;
- active context is refreshed on that same merge candidate.

The loop is:

`Understand -> goal -> execute -> audit -> fix -> audit -> merge -> refresh context`

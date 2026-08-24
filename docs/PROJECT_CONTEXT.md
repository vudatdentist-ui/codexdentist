# Project Context

Last updated: 2026-08-24

This file answers four questions for every contributor or coding agent:

1. What product are we building?
2. What architecture is true on `main` now?
3. Which business and safety invariants must not change accidentally?
4. What work comes next, in what order, and what proves each phase is complete?

For layer rules read `PRODUCT_ARCHITECTURE.md`. For verification read `QA_PLAYBOOK.md`. For deployment/self-host operations read `OPERATIONS.md`.

## Current baseline

The workflow-first refactor stack `#20 -> #26` has been merged into `main` in dependency order. The post-Phase-3 integration baseline is merge commit:

`389f98f587bc871dfc12718a3b96fca76949910f`

The Phase-3 branch tree that passed full CI and the merged `main` tree were identical. Treat Phase 3 as **implemented and integrated**, not as an open migration branch.

Do not revive old stacked branches as a base for new work. New architecture work branches from the latest `main`.

## Product direction

Codexdentist is an open-source, all-in-one dental clinic operating system for Viet Nam, focused first on small and medium clinics that can self-host on a local PC, server, or NAS. Hosted Codexdentist provides the public product/docs experience and isolated demo workspaces; the long-term direction is a community-maintained multi-clinic Dental OS with optional hosted services.

The staff product is **workflow-first, not module-first**. Deep domain capability remains, but the primary interface should match how clinic staff work rather than mirror backend tables/modules.

Primary staff workspaces are:

1. `Today` — current operational attention.
2. `Schedule` — booking, confirmation, arrival, chair/provider dispatch.
3. `Patients` — Patient 360 and longitudinal patient context.
4. `Treatment` — Treatment Cases and execution progress.
5. `Work` — unified operational exceptions/tasks/signals.
6. `Care` — lead/follow-up/recall/no-show recovery and communication outcomes.
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

## Architecture after Phase 3

New architecture follows:

`route -> authenticated/scoped loader or read model -> workspace -> feature/server action -> existing domain/persistence contract`

The new architecture lives primarily under:

- `src/shared/**` — business-agnostic presentation primitives/contracts;
- `src/features/**` — cohesive workflow capability, read-model adapters, server actions;
- `src/workspaces/**` — route-level workflow composition and UI;
- `src/domains/**` — reserved for stable domain contracts when extraction genuinely benefits from it; currently not a required destination for every legacy module.

`src/lib/**`, `src/modules/**`, and large legacy components remain migration territory. They contain valuable, tested business behavior and must be extracted incrementally rather than rewritten for folder purity.

### Canonical / migrated surfaces

| Product surface | Canonical route(s) | Current state |
| --- | --- | --- |
| Today | `/today` | Migrated workspace. `/dashboard` is compatibility entry/redirect. |
| Work | `/work` | Migrated unified operational queue with derived domain signals. |
| Schedule | `/schedule` | Migrated Patient Access workspace. `/schedule/legacy` preserves the old dispatch surface temporarily. |
| Care | `/care` | Migrated follow-up/no-show operational workspace; full legacy CRM capability is not yet fully converged. |
| Patients | `/patients`, `/patients/[patientId]` | Migrated directory + Patient 360 shell/read model. Internal Patient 360 still contains a large Journey compatibility island. |
| Journey / Clinical | `/journey`, `/clinical` | Compatibility entries that compose the canonical Patient 360 workspace. |
| Treatment | `/treatment`, `/patients/[patientId]/treatments/[treatmentServiceId]` | Migrated Treatment Case directory/case and clinical execution. |
| Operations | `/operations` | Migrated staff-operations workspace. Inventory/reports are not yet converged into canonical Operations. |
| Finance | `/operations/finance` | Migrated finance/e-invoice operational workspace. Legacy `/billing` and `/accounting` remain compatibility module routes. |
| Employee self-service | `/employee-app` | Migrated staff self-service workspace. |
| Settings | `/settings` | Still legacy `AppViewPage -> DentalSuite`; canonical product destination is known but migration is pending. |

The migration QA contract also protects the canonical new routes listed in `scripts/qa-route-contract.mjs`.

### Remaining legacy frontier

The shell migration is successful, but the legacy core has **not** been eliminated.

Important migration debt on current `main`:

- `src/components/DentalSuite.tsx` is still the large legacy product renderer for unmigrated routes.
- `src/app/(app)/view-page.tsx` / `AppViewPage` still centralizes many legacy loaders and renders `DentalSuite`.
- `src/modules/journey/PatientJourneyPanel.tsx` remains a very large compatibility island inside Patient 360.
- Legacy routes still using `AppViewPage` include Billing, Accounting, Inventory, Reports, Settings, Services, Staff, CRM, Patient App, Pharmacy, Forms, Learning and other compatibility surfaces.
- `src/modules/**` still contains the old module-first implementation for many domains.
- Large global/legacy CSS remains migration debt; styling cleanup should follow workspace extraction rather than trigger a visual rewrite by itself.

New work must **shrink this frontier, never expand it**.

## Completed refactor phases

### Phase 0/1 — Workflow foundation (`#20`, `#21`, `#22`)

Completed:

- workflow-first shell and workspace switcher;
- canonical Today/Work;
- Patient 360 route/read-model shell;
- canonical Treatment Case directory and case route;
- architecture guardrails preventing new migrated code from depending on `DentalSuite` / `AppViewPage`.

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

Completed:

`Treatment service -> Collection -> Receipt allocation -> Invoice -> E-invoice state -> Reconciliation -> Work`

The provider adapter fails closed when unconfigured, E-invoice state is auditable/append-only, external reconciliation is explicit, and billing/concurrency semantics remain intact.

### Phase 3 — Patient Access (`#26`)

Completed:

`Booking -> Confirmation -> Arrival -> Chair dispatch -> Completed / No-show -> Patient 360 / Care -> Work`

The server enforces status transitions, resource serialization, organization/clinic scope, provider/chair lifecycle and no-show recovery. No-show signals clear only after a real CRM follow-up outcome is recorded.

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

- Patient 360 is the canonical longitudinal patient context; `/journey` and `/clinical` are compatibility entries while extraction continues.
- Timeline history, clinical signing/amendment, patient files and odontogram revision behavior must remain auditable.
- Odontogram uses FDI codes and independent `INITIAL`, `CURRENT`, `EXPECTED` stages with revision/history semantics.
- Treatment-target selection must never overwrite clinical odontogram snapshots.
- Treatment progress cannot regress and must preserve participant, inventory, compensation and audit invariants.
- Billing/Front Desk must not gain clinical mutation rights through workspace composition.

### Billing and E-invoice

- Ledger mutations use retryable PostgreSQL `Serializable` transactions; calculation reads used by a write belong in the same transaction.
- Receipt collection, allocation and invoice issuance are distinct concepts.
- Partial invoices remain separate issued records; overpayment remains unapplied/advance balance rather than inventing invoice value.
- Existing reconciliation/database constraints and tenant ownership checks must remain in force.
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

### Patient Access

- Appointment/provider/chair claims remain server-serialized and clinic-scoped.
- Invalid status regression and reopening final appointment states remain rejected.
- BUSY resource state is released only according to the real in-chair usage contract.
- No-show recovery clears only after a persisted follow-up outcome, not after merely viewing Care/Work.

### Work / Today signals

Operational exceptions should normally be **derived from domain state** and adapted into Work/Today. Do not persist duplicate task rows only to mirror another source of truth.

## Roadmap after Phase 3

Security or production-data incidents can preempt this roadmap. Otherwise, architecture work should proceed in this order.

### Phase 4 — Patient 360 Core Extraction

**Why next:** Patient 360 is canonical, but its core still embeds the giant legacy `PatientJourneyPanel`. This is now the highest-value architectural bottleneck because clinical, odontogram, timeline, forms, files, prescriptions and treatment planning converge there.

**Goal:** make Patient 360 a native composition of scoped features instead of a wrapper around the legacy Journey monolith.

Scope:

- extract encounter/clinical-plan presentation and actions below the workspace layer;
- extract timeline composition without changing historical semantics;
- preserve the odontogram editor/data contract while giving it a clear Patient 360 boundary;
- compose protected files, forms, pharmacy/prescriptions and authorized financial context through explicit Patient 360 sections/read models;
- migrate patient create/edit demographics out of `/patient-management` into the canonical Patients workspace;
- keep `/journey` and `/clinical` as compatibility entries until parity is proven.

Exit criteria:

- `src/workspaces/patients/**` no longer imports `src/modules/journey/PatientJourneyPanel`;
- canonical Patients handles directory, create/edit and patient chart flows;
- Journey/clinical compatibility routes still work or have reviewed redirects;
- clinical, odontogram, file, tenant, role, mobile and browser regression gates are green on one final HEAD.

### Phase 5 — Care / CRM Convergence

**Goal:** make `/care` own the full patient-acquisition and follow-up loop instead of splitting operational Care from legacy CRM.

Scope:

- lead intake and lead-to-patient conversion;
- recall/follow-up queues and communication outcomes;
- no-show recovery already introduced in Phase 3;
- move new CRM mutations/read models below route/workspace boundaries;
- adapt resulting exceptions into Today/Work without duplicate state;
- retire `/crm` to a compatibility adapter/redirect only after parity.

Exit criteria: core lead/create/convert/follow-up workflows no longer require `DentalSuite` and CRM compatibility behavior remains covered.

### Phase 6 — Operations Completion

**Goal:** finish the management operating system around the canonical `/operations` workspace.

Scope:

- migrate Inventory into Operations;
- migrate Reports into Operations;
- converge legacy Billing/Accounting navigation into the existing canonical Finance workspace without rewriting ledger semantics;
- keep Staff management/self-service aligned with the Phase-24 earnings contract;
- convert `/billing`, `/accounting`, `/inventory`, `/reports`, `/staff` into thin compatibility routes or redirects only after parity.

Exit criteria: those primary management workflows no longer render through `AppViewPage -> DentalSuite`, and all billing/tenant/staff regression suites remain green.

### Phase 7 — Settings and Clinical-Support Consolidation

**Goal:** make Settings the canonical home for configuration while patient-context support tools live where work happens.

Scope:

- rebuild `/settings` as a native workspace for clinic configuration, roles, service catalog, compensation policies, templates, integrations and audit;
- converge `/services` into the Settings/service-catalog experience where appropriate;
- integrate Forms and Pharmacy/prescription workflows into Patient 360 context, keeping standalone routes as compatibility surfaces until parity;
- avoid schema churn that exists only to support navigation cleanup.

Exit criteria: Settings/Services/Forms/Pharmacy primary workflows no longer require `DentalSuite`.

### Phase 8 — Patient Portal / External Experience

**Goal:** redesign the patient-facing application only after the staff core is stable.

Scope:

- future appointments/self-service actions;
- treatment-plan actions;
- open invoice/balance context;
- consent/forms/files/notification experience;
- strict `portalUserId` authorization and terminal-state transition rules.

Exit criteria: `/patient-app` is independent of `AppViewPage/DentalSuite` and all portal isolation/security tests pass.

### Phase 9 — Legacy Shell Extinction and Architecture Freeze

**Goal:** finish the migration rather than carrying two architectures indefinitely.

Scope:

- remove the last protected-route dependencies on `AppViewPage` and `DentalSuite`;
- retire compatibility islands in `src/modules/**` once their behavior is owned by stable features/workspaces;
- split large legacy/global styling only where ownership is clear;
- make migrated-route architecture delegation strict/blocking in CI;
- remove obsolete compatibility route QA only together with reviewed redirect/removal behavior.

Exit criteria:

- no protected staff workflow route imports or renders `AppViewPage` / `DentalSuite`;
- no new product behavior is implemented in frozen legacy modules;
- strict architecture audit passes on every canonical workspace route;
- full CI and Docker build are green.

### Phase 10 — Productization, Knowledge and Public Surface

Only after the staff architecture is stable:

- recreate the public landing/product storytelling from current `main` rather than transplanting stale design branches;
- decide Learning/Community/Knowledge/RAG direction;
- improve release notes, upgrade compatibility and support intake;
- expand community beta/self-host validation.

These are productization tasks, not reasons to postpone removal of known staff-core architecture debt.

## Parallel maintenance lane

Maintenance is not a numbered architecture phase:

- dependency updates (`Dependabot` PRs) should be rebased/reviewed separately and run through the same safety gates;
- critical security fixes may preempt any phase;
- backup/restore, Windows/Linux/NAS and deployment work follow `OPERATIONS.md`;
- public landing experiments should not be merged from branches based on the pre-Phase-3 product tree.

## Agent decision rules

When a task is ambiguous:

1. Protect production/security/data invariants first.
2. If it is architecture/refactor work and no phase is specified, continue **Phase 4**.
3. Extract behavior from legacy code; do not rewrite stable business logic merely to change folders.
4. Do not create a new primary workspace unless the product architecture is explicitly changed.
5. Do not retire a compatibility route until canonical parity and QA evidence exist.
6. Do not weaken a test to make a migration pass. Fix the implementation or the test harness without weakening production behavior.
7. Update this file when the current phase, canonical route, or invariant changes.

## Project-level Definition of Done for a phase

A phase is complete only when one final HEAD satisfies its contract and the applicable full verification chain: architecture/type/build, security and tenant isolation, high-risk domain regressions, route/browser QA, targeted end-to-end smoke, and Docker/release checks required by `QA_PLAYBOOK.md`.

After merge, update active context so the next agent starts from the new `main`, not from the completed branch.

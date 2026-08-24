# Dental OS Product Architecture

Last updated: 2026-08-24

This document is the architecture contract for the Codexdentist staff product. `PROJECT_CONTEXT.md` describes current state and roadmap in more operational detail; this file defines the shape we are migrating toward and the boundaries new code must obey.

## Product rule

Codexdentist keeps deep dental-clinic capability while reducing the number of concepts staff must understand at once.

- Preserve business rules, tenant scope, clinical history, billing invariants, audit, protected files, odontogram revisions and compensation semantics.
- Replace module-first navigation with workflow-first workspaces.
- Do not remove a valuable workflow merely to make a screen look cleaner.
- Reduce simultaneous visibility, not product depth.
- Visible copy should communicate a fact, state, risk or action; avoid explanatory filler and implementation diagnostics.
- Intelligence should surface priority and next action through existing workflows rather than add generic AI chrome everywhere.

## Primary workspaces

1. `Hôm nay / Today` — what needs attention now.
2. `Lịch hẹn / Schedule` — booking, confirmation, arrival, chair and provider flow.
3. `Bệnh nhân / Patients` — Patient 360, timeline, odontogram, clinical record, forms, prescriptions, files and authorized financial context.
4. `Điều trị / Treatment` — Treatment Cases, service instances, steps, progress, teeth/targets and economics.
5. `Công việc / Work` — unified operational exceptions/tasks/signals.
6. `Chăm sóc / Care` — leads, recall, follow-up, no-show recovery and communication outcomes.
7. `Vận hành / Operations` — staff, finance, inventory and reporting.
8. `Cài đặt / Settings` — clinics, roles, services, compensation, templates, integrations and audit.

A backend/domain capability does not automatically become a primary navigation item.

## Canonical architecture flow

For new or migrated protected routes:

`route -> require session/view permission -> scoped loader/read model -> workspace -> feature/server action -> existing domain/persistence contract`

Responsibilities:

### `src/app/**`

- route composition only;
- authentication/view boundary;
- parse route/search params;
- call scoped loader/read model;
- render a workspace;
- must not become a new business-logic layer.

### `src/workspaces/**`

- compose one user workflow and its visual hierarchy;
- consume explicit read models/features;
- may orchestrate presentation across domains;
- must not import app routes/actions;
- must not import `DentalSuite` or `AppViewPage`.

### `src/features/**`

- owns cohesive workflow capabilities, server actions and adapters such as Patient Access, treatment progress, finance/e-invoice, staff self-service and Work signals;
- may depend on shared presentation and existing server/domain contracts;
- must not depend upward on workspaces/app routes.

### `src/shared/**`

- business-agnostic UI/contracts only;
- must not know dental business rules, permissions, tenant scope, Prisma or workspace composition.

### `src/domains/**`

Reserved for stable domain contracts when extraction genuinely improves ownership. It is not a mandatory destination for every file in `src/lib` or `src/modules`; folder movement without a behavioral boundary is not architecture progress.

### Migration territory

`src/lib/**`, `src/modules/**`, `src/components/DentalSuite.tsx`, and `src/app/(app)/view-page.tsx` contain substantial existing behavior. Treat them as compatibility sources to extract from incrementally, not as places to add new product architecture.

## Architecture state after Phase 3

The stack `#20 -> #26` is merged into `main`.

### Migrated/canonical now

- `/today` — Today cockpit.
- `/work` — unified operational queue.
- `/schedule` — Patient Access schedule; `/schedule/legacy` is temporary compatibility.
- `/care` — operational follow-up/no-show workspace.
- `/patients` and `/patients/[patientId]` — directory + Patient 360 shell/read model.
- `/journey` and `/clinical` — compatibility entries to Patient 360.
- `/treatment` — Treatment Case directory.
- `/patients/[patientId]/treatments/[treatmentServiceId]` — canonical Treatment Case execution.
- `/operations` — staff operations.
- `/operations/finance` — finance/e-invoice operations.
- `/employee-app` — staff self-service.

### Not fully migrated yet

- Patient 360 still embeds the legacy `PatientJourneyPanel` as a compatibility island.
- `/crm` still owns legacy lead/create/convert capability not yet converged into Care.
- `/billing` and `/accounting` still own large compatibility surfaces even though canonical Finance exists.
- `/staff` still owns legacy management/payroll surface even though Operations/Employee self-service exist.
- `/inventory` and `/reports` are not yet converged into Operations.
- `/settings` and `/services` remain module-first configuration surfaces.
- `/forms` and `/pharmacy` remain standalone module-first clinical-support surfaces.
- `/patient-app` remains a separate legacy patient-facing experience.
- Learning/Community remain deferred product surfaces.

## Completed architecture slices

### Workflow shell

Introduced Today/Work, workflow-first navigation and a route/workspace composition model without a permanent module sidebar.

### Patient 360 shell

Introduced the canonical patient directory/detail route and scoped Patient 360 loader while preserving the Journey implementation temporarily as a compatibility island.

### Treatment Case

Made `TreatmentService` the operational case object and added canonical directory/detail routes without inventing a second treatment persistence model.

### Clinical execution

Moved new treatment-progress mutation below the workspace layer; preserved compensation, inventory, participant, clinical and billing invariants; derived stale/unsigned clinical signals into Work.

### Staff operations

Added unified earnings read model, management Operations and Employee self-service while keeping persisted PayrollRun semantics separate from live earnings.

### Finance / E-invoice

Added canonical Finance workspace, reconciliation/e-invoice state and derived finance Work signals without rewriting the billing ledger.

### Patient Access

Migrated Schedule/Care operational flow with explicit confirmation, arrival, chair dispatch, completion/no-show lifecycle and derived Today/Work signals.

## Golden operational flows

### Patient access

`Appointment request/booking -> Confirmation -> Arrival -> Chair/provider dispatch -> Completed / No-show -> Patient 360 / Care -> Work`

### Clinical execution

`Patient 360 -> Encounter/clinical -> Odontogram -> Treatment Case -> Service Progress`

A progress event can affect patient history, material consumption, billing state, staff compensation and operational signals. Those effects must stay transactionally/auditably consistent with existing contracts.

### Finance

`Treatment service -> Collection -> Receipt allocation -> Invoice -> E-invoice state -> Reconciliation -> Work`

Receipt collection, allocation, invoice issuance and external e-invoice state remain distinct.

### Staff operations

`Attendance / service progress / referral attribution -> Live earnings -> Payroll state -> Work exception`

Live earnings are not the same record as approved/paid payroll.

### Exception flow

`Domain state -> derived signal -> Work/Today visibility -> real domain resolution -> signal disappears`

Do not persist a second task record merely to duplicate another domain source of truth.

## Compatibility strategy

Compatibility is allowed to lower migration risk, but every compatibility surface needs an owner and retirement condition.

Rules:

1. A canonical route owns new product behavior.
2. A legacy route may delegate to the canonical workspace or temporarily render the legacy implementation.
3. New features must not be added to `DentalSuite`, `AppViewPage`, or a legacy module if the canonical workspace already exists.
4. Do not delete a compatibility route until behavior parity, role/tenant scope and browser/route QA are proven.
5. Prefer redirect/thin adapter after parity; remove only when callers/bookmarks and QA contracts are intentionally retired.
6. `/schedule/legacy` is explicitly legacy and must not be accidentally included as a canonical migration route.

## Architecture roadmap

Detailed scope and exit criteria live in `PROJECT_CONTEXT.md`. The architecture sequence is intentionally split by high-risk domain so a single phase does not mix unrelated invariants.

### Phase 4 — Patient 360 Core Extraction

Replace the embedded `PatientJourneyPanel` monolith with native Patient 360 sections/features. Move patient demographics create/edit into canonical Patients. Preserve Journey/Clinical compatibility until parity.

### Phase 5 — Care / CRM Convergence

Move lead intake, conversion, recall/follow-up and communication outcomes into canonical Care. Retire CRM to compatibility after parity.

### Phase 6 — Finance Surface Convergence

Converge the large legacy Billing and Accounting surfaces into canonical `/operations/finance` while preserving ledger, Serializable transaction, reconciliation and e-invoice invariants.

### Phase 7 — Workforce Management Convergence

Converge remaining Staff/Payroll management into Operations while preserving compensation, source commission and persisted PayrollRun semantics; `/employee-app` remains self-service.

### Phase 8 — Inventory and Reporting Operations

Move Inventory and Reports into Operations with existing stock/material and role/clinic semantics, independent from Finance/Staff migration risk.

### Phase 9 — Settings and Service Catalog

Make Settings native and canonical; converge Services/catalog configuration with role, compensation-policy and treatment-step safety preserved.

### Phase 10 — Clinical Support Convergence

Move Forms/consent and Pharmacy/prescription workflows into Patient 360/clinical context while keeping compatibility routes until parity.

### Phase 11 — Patient Portal

Rebuild the external patient experience with strict patient-self authorization after staff core and clinical support stabilize.

### Phase 12 — Legacy Shell Extinction

Remove remaining protected-route dependence on `AppViewPage` / `DentalSuite`, retire extracted module islands, and make architecture route guards strict in CI.

### Phase 13 — Productization / Knowledge / Public Surface

Only after staff architecture stabilizes: refresh public product storytelling from current `main`, decide Learning/Community/Knowledge/RAG direction, and harden community/release experience.

## UI composition rules

- No permanent 220px product sidebar as the default staff shell.
- No wall of metric cards on Today.
- No right KPI column that simply repeats the main work stream.
- Do not force every workspace into one three-column layout.
- Prefer rows, timelines, split panes, context drawers, full-width clinical canvases and native work objects.
- Odontogram is a first-class clinical surface, not a dashboard widget.
- Timeline remains the longitudinal patient-history spine.
- Service progress remains a first-class clinical/economic primitive.
- Dense pages keep the primary workflow visible and move low-frequency tools into secondary disclosure.

## Safety boundaries

Architecture work must not weaken:

- `organizationId` and accessible-clinic scoping;
- server-side route/action permissions;
- protected patient-file authorization/storage rules;
- clinical signing/amendment semantics;
- odontogram stage/revision/history behavior;
- billing Serializable transaction and reconciliation invariants;
- e-invoice fail-closed/external-reconciliation semantics;
- treatment-progress inventory/compensation/audit behavior;
- payroll/source-commission auditability;
- Patient Access transition/resource concurrency rules;
- patient portal self-scope.

If a migration appears to require changing one of these invariants, stop treating it as a frontend refactor: define and review it as an explicit domain change with dedicated tests.

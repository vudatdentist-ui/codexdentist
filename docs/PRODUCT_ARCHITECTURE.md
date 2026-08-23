# Dental OS Product Architecture

This document is the product-architecture contract for the staff application redesign.

## Product rule

Dental OS keeps deep domain capability while reducing the number of concepts a staff member must understand.

- Preserve business rules, tenant scope, clinical history, billing invariants, audit, files, and payroll semantics.
- Replace module-first navigation with workflow-first workspaces.
- Do not remove a valuable workflow just to make a screen look cleaner.
- Reduce simultaneous visibility instead of reducing product depth.
- Do not add explanatory filler. Visible copy should communicate a fact, state, risk, or action.
- Intelligence should surface priority and next action instead of adding AI chrome everywhere.

## Primary workspaces

1. `Hôm nay` — what needs attention now.
2. `Lịch hẹn` — appointment, chair, provider, arrival, confirmation.
3. `Bệnh nhân` — Patient 360, timeline, odontogram, clinical record, forms, prescriptions, files, financial context.
4. `Điều trị` — treatment cases, service instances, steps, progress, teeth, economics.
5. `Công việc` — unified operational queue.
6. `Chăm sóc` — leads, recall, follow-up, no-show and communication.
7. `Vận hành` — finance, staff, inventory and reporting.
8. `Cài đặt` — clinic, roles, services, compensation, templates, integrations and audit.

A domain capability does not automatically become a primary navigation item.

## Migration strategy

The migration is incremental. Existing domain loaders and actions remain valid until a new workspace has equivalent behavior and QA coverage.

New architecture should follow:

`route -> workspace loader/read model -> workspace UI`

New workspaces must not depend on `DentalSuite` or `AppViewPage`.

The first migration slice introduces:

- `/today` as the staff default surface backed by existing dashboard and task-inbox data.
- `/work` as the unified task surface backed by the existing task-inbox engine.
- a text-first, no-permanent-sidebar workspace chrome.
- compatibility of the legacy `dashboard` permission key while its route resolves to `/today`.

The Patient 360 slice introduces:

- `/patients` as the patient directory inside the new workspace chrome.
- `/patients/[patientId]` as the canonical Patient 360 route.
- one patient context that composes schedule, clinical record, treatment planning, odontogram, timeline, files, forms, prescriptions, CRM context and authorized financial context.
- `/journey` and `/clinical` as compatibility aliases over the same Patient 360 workspace while legacy server actions are migrated incrementally.
- `/patient-management` as a temporary compatibility adapter for create/edit demographics until those mutations move into the new Patient workspace.

The Treatment Case slice introduces:

- `/treatment` as the treatment-case directory instead of another Patient 360 alias.
- `/patients/[patientId]/treatments/[treatmentServiceId]` as the canonical Treatment Case route.
- `TreatmentService` as the operational case object because it already owns teeth/target context, service steps, progress events, collections, invoice links and compensation impact.
- a case page that exposes progress, steps, progress history, financial state and scoped clinical context while linking back to Patient 360.
- no new treatment persistence model and no change to the existing `TreatmentPlan` planning model.

The Patient 360 workspace may reuse a legacy module as a temporary compatibility island, but the route and workspace loader must not depend on `DentalSuite` or `AppViewPage`. New mutations should move below the workspace layer rather than adding more route-layer dependencies.

## Golden flow

`Appointment -> Arrival -> Patient -> Encounter -> Odontogram/Clinical -> Treatment Case -> Service Progress`

A service progress event may affect:

- patient timeline,
- material consumption,
- billing state,
- staff compensation,
- operational signals.

Abnormal states should become a signal, then a work item, then appear in `Hôm nay` or `Công việc` when relevant.

## Deferred product surfaces

Learning and Community are not primary-workspace redesign targets. Keep their data and current implementation until a future Knowledge/RAG or collaboration direction is approved.

Patient App remains a separate experience and should be redesigned only after the staff core is stable.

## UI rules

- No permanent 220px product sidebar as the default shell.
- No wall of metric cards on `Hôm nay`.
- No right-hand KPI column that repeats information already present in the work stream.
- Do not force every workspace into the same three-column template.
- Prefer rows, timelines, split panes, context drawers, full-width clinical canvases, and native work objects.
- Odontogram is a first-class clinical workspace, not a small dashboard widget.
- Timeline remains the patient-history spine.
- Service progress remains a first-class treatment and economics primitive.

## Safety

UI restructuring must not weaken:

- `organizationId` and clinic scoping,
- server-side permissions,
- protected patient files,
- clinical signing/amendment rules,
- billing transaction invariants,
- odontogram revision/history behavior,
- compensation auditability.

# Phase 3 — Front Desk / Patient Access Loop v1

## Goal

Connect the operational entrance of the clinic into one workflow:

`Appointment request/booking -> confirmation -> arrival -> chair dispatch -> completed/no-show -> Patient 360 / Care follow-up -> Work`

This phase is not a dashboard redesign. Schedule is a work surface. Abnormal patient-access states become Work; completed access states continue into the existing Patient 360 / Treatment flow.

## Canonical surfaces

- `/schedule` — patient-access operations for the selected work day.
- `/care` — follow-up queue and recent no-show recovery.
- `/crm` — compatibility alias over the Care workspace while legacy CRM mutations remain available.
- `/work` — receives derived patient-access exceptions.

## Operational states

The existing Appointment states remain authoritative:

`REQUESTED -> CONFIRMED -> ARRIVED -> IN_CHAIR -> COMPLETED`

`REQUESTED | CONFIRMED -> NO_SHOW`

Cancellation remains a separate action. The new patient-access mutation path must reject invalid regressions and final-state reopening.

## Intelligence / Work signals

Derived signals, not duplicated ledger rows:

- appointment still `REQUESTED` as its start approaches;
- `CONFIRMED` appointment is overdue without arrival;
- `ARRIVED` patient has waited materially longer than expected;
- recent `NO_SHOW` has no recorded recovery/follow-up activity.

Signals must respect organization + active-clinic scope and disappear when the underlying state is resolved.

## Care handoff

A no-show is not automatically treated as contacted. Care must show unresolved no-shows until a staff member records a real follow-up outcome. The follow-up event uses existing CRM activity persistence and must be scoped to the patient/clinic.

No SMS/Zalo/email provider success is simulated in this phase.

## Schedule safety

- keep existing provider/chair conflict checks;
- keep server-side appointment permissions;
- enforce tenant/clinic-scoped patient/provider/chair relations;
- when a patient enters a chair, mark chair/provider operationally busy;
- when treatment access completes, release operational busy state without deleting appointment history;
- do not modify clinical, treatment-progress, billing, e-invoice, payroll, odontogram, or patient-file semantics.

## Data-minimization fix in scope

The schedule read model must not serialize patients outside the session's allowed clinic scope. Existing schedule loading is tightened accordingly.

## Architecture

New code follows:

`route -> server read model -> workspace UI`

- new Schedule/Care workspaces do not import `src/app/**` modules;
- patient-access server actions live below the route/workspace layer;
- legacy routes/actions may remain compatibility adapters during migration;
- Work signals are derived and do not mutate appointment or CRM rows merely by being viewed.

## QA loop

Phase 3 is complete only when the final HEAD passes:

1. architecture/type/build gates;
2. tenant/security/action-permission regressions;
3. existing clinical/staff/finance E2E regressions;
4. desktop/mobile Browser QA for `/schedule` and `/care`;
5. deterministic patient-access E2E covering confirmation, arrival, chair dispatch, completion/resource release, no-show -> Work/Care, follow-up -> signal cleared;
6. invalid status regression rejection and role boundaries;
7. Docker production image build.

The implementation is intentionally iterative: plan check -> implementation -> audit -> fix -> plan re-check -> audit again until all gates are green on one final HEAD.

# Phase 3 — Front Desk / Patient Access Loop v1

## Goal

Connect the operational entrance of the clinic into one workflow:

`Appointment request/booking -> confirmation -> arrival -> chair dispatch -> completed/no-show -> Patient 360 / Care follow-up -> Work`

This phase is not a dashboard redesign. Schedule is a work surface. Abnormal patient-access states become Work; completed access states continue into the existing Patient 360 / Treatment flow.

## Canonical surfaces

- `/schedule` — patient-access operations for the selected work day.
- `/care` — canonical operational follow-up queue and recent no-show recovery.
- `/crm` — the full compatibility CRM surface for lead creation/conversion and advanced CRM workflows while those mutations remain legacy.
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

No SMS/Zalo/email provider success is simulated in this phase. The Care action records an externally performed contact/outcome; it does not claim that Dental OS sent the message or completed the call.

## Schedule safety

- keep existing provider/chair conflict checks;
- keep server-side appointment permissions;
- enforce tenant/clinic-scoped patient/provider/chair relations;
- serialize appointment transitions and resource claims so concurrent operators cannot accept incompatible states from the same snapshot;
- when a patient enters a chair, mark chair/provider operationally busy;
- when treatment access completes, release operational busy state only when no other in-chair appointment still uses that resource;
- do not modify clinical, treatment-progress, billing, e-invoice, payroll, odontogram, or patient-file semantics.

## Data-minimization fix in scope

Both the canonical schedule read model and the legacy schedule compatibility loader must not serialize patients outside the session's allowed clinic scope.

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
6. invalid status regression rejection, concurrent incompatible transition serialization, idempotent concurrent no-show recovery, cross-clinic data minimization, and role boundaries;
7. Docker production image build.

The implementation is intentionally iterative: plan check -> implementation -> audit -> fix -> plan re-check -> audit again until all gates are green on one final HEAD.

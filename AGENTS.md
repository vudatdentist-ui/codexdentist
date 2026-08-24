# Codexdentist Agent Guide

Last updated: 2026-08-24

## Start here

Before substantial work, read these files in order:

1. `docs/PROJECT_CONTEXT.md` — current product state, completed phases, migration frontier, invariants, and roadmap.
2. `docs/PRODUCT_ARCHITECTURE.md` — canonical workspaces, layer boundaries, compatibility rules, and target architecture.
3. `docs/QA_PLAYBOOK.md` — required verification and Definition of Done.
4. `docs/OPERATIONS.md` only when deployment, backup/restore, self-hosting, production configuration, or go-live is involved.

Source-of-truth order is: **latest `main` code > these active docs > merged PR history > chat history**. Do not use an old branch, draft PR, or previous agent handoff as current architecture context.

## Current milestone

The workflow-first refactor stack `#20 -> #26` is merged into `main`. The post-Phase-3 integration baseline is merge commit `389f98f587bc871dfc12718a3b96fca76949910f`.

Completed architecture now includes:

- workflow shell and canonical `Today` / `Work`;
- Patient 360 routes and compatibility aliases;
- Treatment Case directory and execution workspace;
- clinical progress execution and derived Work signals;
- unified staff earnings / employee self-service;
- Finance / E-invoice operations;
- front-desk Patient Access: Schedule, arrival/chair lifecycle, Care follow-up, no-show recovery, Today/Work signals.

The default next architecture phase is **Phase 4 — Patient 360 Core Extraction**. Do not start a different broad refactor unless the task explicitly requires it or a production/security issue takes priority.

## Architecture freeze and migration territory

New architecture follows:

`route -> authenticated/scoped loader or read model -> workspace UI -> feature action -> existing domain/persistence contract`

`src/shared`, `src/features`, and `src/workspaces` are the new architecture. `src/domains` is reserved for stable domain contracts when extraction genuinely needs it; do not create domains merely to move files.

The following are compatibility/migration territory, not places to grow new product architecture:

- `src/components/DentalSuite.tsx`;
- `src/app/(app)/view-page.tsx` / `AppViewPage`;
- `src/modules/**`;
- the Patient 360 compatibility island `src/modules/journey/PatientJourneyPanel.tsx`.

Do not add a new dependency from migrated routes, features, or workspaces to `DentalSuite`, `AppViewPage`, or another legacy module. A legacy file may be touched only to preserve compatibility, fix a defect, or extract behavior with parity tests.

## Working protocol

For refactor work use this loop until the phase contract is complete:

`Understand -> define completion goal -> execute -> audit -> fix -> audit`

- Branch from the latest `main`.
- Keep one phase or coherent extraction slice per branch/PR.
- Preserve behavior before deleting a compatibility path.
- Prefer extraction and composition over rewrites.
- Do not mix opportunistic Prisma-schema, billing-model, clinical-model, or authorization redesign into a UI/architecture migration.
- Derived Today/Work signals should remain derived unless the business object itself is persistent; do not create duplicate task rows to mirror domain state.
- Compatibility routes stay until canonical parity is proven and their redirect/removal is explicitly covered by QA.

## Non-negotiable safety rules

- Preserve real data. Never reset, reseed, delete, or blank real data unless explicitly requested.
- Treat Vietnamese text as UTF-8. Run `npm run encoding:check` after bulk text/UI copy edits.
- Enforce permissions in loaders/actions, never only in UI.
- Scope business data by `organizationId`; clinic records must also respect the session's accessible clinic ids.
- Patient files, auth, tenant isolation, billing, payroll/commission, clinical history, odontogram revisions, AI audit, notifications, and PHI/PII are high-risk.
- Billing/e-invoice concurrency and reconciliation semantics must not be weakened by a frontend migration.
- Patient Access status transitions, resource claims, clinic scope, and no-show recovery semantics must remain server-enforced.
- User-facing workflow UI must not mention database connectivity, seed state, server console, or other implementation diagnostics.

## Definition of Done for a refactor slice

A slice is not complete because the UI renders. On one final HEAD it must:

- pass encoding, TypeScript, architecture audit, production build, route smoke, and applicable browser QA;
- preserve security, tenant, action-permission, patient-file, billing/concurrency, and data-integrity gates;
- run the targeted regression smoke for every affected high-risk workflow;
- keep desktop/mobile canonical routes free of blocker findings;
- keep compatibility routes working until their retirement is part of the same reviewed contract;
- document any changed product rule in `PROJECT_CONTEXT.md`, architecture rule in `PRODUCT_ARCHITECTURE.md`, or verification rule in `QA_PLAYBOOK.md`.

Use the exact gate matrix in `docs/QA_PLAYBOOK.md` rather than inventing a parallel test framework.

## Documentation discipline

Keep active documentation small. Prefer updating the four files above instead of creating phase diaries, refactor logs, session handoffs, or duplicated roadmaps. Completed phase documents may remain as historical contracts, but the current roadmap belongs in `PROJECT_CONTEXT.md` and `PRODUCT_ARCHITECTURE.md`.

Use Git history and merged PRs for chronology. Active docs describe **what is true now and what comes next**.

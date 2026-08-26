# Codexdentist Agent Guide

Last updated: 2026-08-27

This repository intentionally keeps active documentation small. Before substantial work, read:

1. `docs/PROJECT_CONTEXT.md` — canonical product direction, architecture, invariants, and phase gates.
2. `docs/QA_PLAYBOOK.md` — required verification and audit loops.
3. `docs/OPERATIONS.md` — only when deploy, backup/restore, hosting, runtime jobs, go-live, or production configuration is involved.

`docs/PROJECT_CONTEXT.md` replaces all previous product/refactor context. Git history, old chats, retired migration plans, and deleted documents are historical evidence only and must not be revived as active instructions unless the canonical context explicitly reintroduces them.

Repository code plus the active docs above beats chat history.

## Core Rules

- Preserve real data. Do not reset, reseed, delete, truncate, or blank operational data unless the user explicitly asks and the restore path is understood.
- Treat Vietnamese text as UTF-8. Avoid unsafe bulk text rewrites; use patch/update operations or UTF-8-safe tooling.
- Run `npm run encoding:check` after bulk text edits and whenever Vietnamese UI copy changes.
- Enforce permissions server-side. UI visibility is never authorization.
- Scope business data by `organizationId`; clinic-owned records must also respect accessible clinic IDs.
- Patient files, auth, tenant isolation, billing, payroll/commission, clinical history, AI audit, notifications, integrations, and PHI/PII are high-risk.
- User-facing workflow UI must not expose PostgreSQL, database connectivity, seed/demo implementation details, server console, or architecture terminology.
- External providers must enter through application/integration boundaries and must not write canonical core domain tables directly.
- Prefer strangler refactors with preserved behavior and tests over broad rewrites.
- A phase is not complete when implementation is written; follow the audit -> fix -> re-audit loop and satisfy every exit criterion in `docs/PROJECT_CONTEXT.md`.
- Never weaken, skip, or delete a safety test merely to make a refactor pass.

## Architecture Direction

Target layers are:

```text
shared -> domains -> features/application -> workspaces -> app
                    ^
                    |
              infrastructure
                    ^
                    |
               integrations
```

Read the precise dependency rules in `docs/PROJECT_CONTEXT.md`. Existing `src/components`, `src/modules`, and broad `src/lib` code are migration territory, not proof that new code may ignore the target boundaries.

## Common Commands

```bash
docker compose up -d
npm run dev
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run test:security
npm run test:tenant
npm run test:smoke
npm run browser:qa
npm run build
```

Use the focused test matrix in `docs/QA_PLAYBOOK.md` for billing, Journey/files, permissions, compensation, integrations, schema changes, and release work.

Local app: `http://127.0.0.1:3000`

Smoke credentials are test-only and must never be treated as production onboarding credentials.

## Documentation Rules

- Keep active Markdown small; prefer updating one of the three active operational/context documents over creating parallel plans.
- Product, architecture, invariant, integration, or phase changes belong in `docs/PROJECT_CONTEXT.md`.
- Verification/gate changes belong in `docs/QA_PLAYBOOK.md`.
- Deploy, hosting, backup, restore, job, and production configuration changes belong in `docs/OPERATIONS.md`.
- Use Git history for change history; do not create session handoff logs, long audit dumps, or a second product context.

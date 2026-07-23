# Codexdentist Agent Guide

Last updated: 2026-05-29

This repo intentionally keeps active documentation small. Read only these files before substantial work:

1. `docs/PROJECT_CONTEXT.md`
2. `docs/QA_PLAYBOOK.md`
3. `docs/OPERATIONS.md` when deploy, backup, S22U, go-live, or production config is involved

Repo code plus these docs beats chat history. Do not recreate long refactor logs, session handoffs, CLI continuation plans, or audit dumps.

## Core Rules

- Preserve real data. Do not reset, reseed, delete, or blank data unless the user explicitly asks.
- Treat Vietnamese text as UTF-8. Avoid PowerShell bulk `Get-Content`/`Set-Content`; use `apply_patch`, Node UTF-8 APIs, or safe formatters.
- Run `npm run encoding:check` after bulk text edits and whenever Vietnamese UI copy changes.
- Enforce permissions in loaders/actions, not only in UI.
- Scope operational data by `organizationId`; clinic records must also respect accessible clinic ids.
- Patient files, auth, tenant isolation, billing, payroll/commission, AI audit, notifications, and PHI/PII are high-risk.
- User-facing workflow UI must not mention PostgreSQL, database connectivity, demo mode, seed data, or server console.

## Common Commands

```bash
docker compose up -d
npm run dev
npm run build
npm run typecheck
npm run encoding:check
npm run test:seed-users
npm run test:smoke
npm run browser:qa
npm run agent:health
```

Local app: `http://127.0.0.1:3000`

Smoke owner after seeding: `owner@nhavista.vn / CodexSmoke2026!`

## Documentation Rules

- Keep active Markdown under 8 files.
- Prefer updating one of the active docs over adding a new file.
- If a product or safety rule changes, update `docs/PROJECT_CONTEXT.md`.
- If a verification or release rule changes, update `docs/QA_PLAYBOOK.md` or `docs/OPERATIONS.md`.
- Use Git history for change history; do not create a separate work log.

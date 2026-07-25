# QA Playbook

Last updated: 2026-07-25

## Fast Check

```powershell
npm run encoding:check
npm run typecheck
npm run test:security
node scripts/agent-health-check.mjs
node scripts/agent-module-audit.mjs
```

## Route And Browser Checks

```powershell
npm run test:seed-users
npm run test:smoke
npm run browser:qa
```

`browser:qa` checks desktop `1440x900` and mobile `390x844` for protected routes. Review failures for route errors, console/network errors, horizontal overflow, broken modal/form layout, technical copy, and mojibake.

## Targeted Checks

Use when touching the relevant area:

```powershell
npm run test:billing
npm run test:roles
npm run test:actions
npm run test:hardening
npm run test:tenant
npm run test:patient-files
npm run test:pilot-workflows
npm run test:data-integrity
npm run test:source-commission
npm run readiness:check
```

Full pilot gate:

```powershell
npm run pilot:qa
```

## Public And Self-Host Checks

- `/` shows the product site on the root domain and redirects tenant/app hosts to the application.
- `/features` presents the feature guide and links to the public demo and installation docs.
- `/docs` renders a Windows-first beginner flow with official download sources, expected results, LAN/firewall setup, backup, restore, update, troubleshooting, and security guidance.
- `https://demo.codexdentist.com/` creates an isolated expiring organization, signs in, and displays the expiry banner; `/demo` on that host redirects to `/`.
- `https://odontogram.codexdentist.com/` keeps the root URL, switches between 32 permanent and 20 primary FDI teeth, renders upper/lower anatomical silhouettes, exposes five keyboard-accessible surfaces per tooth, keeps marks isolated by dentition, and has no horizontal overflow at `390x844`.
- Demo sessions stop working after expiry; cleanup removes only expired demo organizations.
- Demo mode blocks patient-file uploads and outbound notification delivery.
- A clean `docker build` succeeds without a local `.env` or database.
- A fresh self-host stack applies migrations, exposes `/setup`, creates the first owner, then locks `/setup`.
- `doctor` reports health and LAN addresses; `backup` produces a valid PostgreSQL custom dump and patient-file archive.

Self-host packaging gate:

```powershell
docker compose --env-file .env.selfhost.example -f compose.selfhost.yml config --quiet
docker build -t codexdentist:qa .
```

## Security And Isolation Checklist

- Login and password reset are rate-limited.
- Session cookie is `httpOnly`; production uses secure cookies.
- Demo auth/fallback is disabled in production.
- Every protected route uses session/view checks.
- Every mutation enforces action-level permission server-side.
- Every mutation fetches target resource by tenant scope before writing.
- Export routes check role and resource access.
- Patient portal is self-only.
- Uploads enforce size, MIME, extension, storage, and unsafe scan status rules.
- Upload content signatures match declared image/PDF/video/Office types before storage.
- Production readiness rejects requests without `JOB_SECRET`.
- Unsupported HTTP methods and untrusted Host headers are rejected before route handling.
- Login throttling persists across application restarts.
- Billing void/refund requires role, reason, and audit.

Tenant negative tests to preserve:

- Org A cannot list/edit Org B patients, invoices, payments, or files.
- Tenant subdomain cannot authenticate a user from another tenant.
- Patient account cannot access another patient.

## Browser Manual Targets

Minimum protected routes:

```text
/dashboard
/schedule
/patients
/journey
/billing
/accounting
/services
/staff
/crm
/inventory
/pharmacy
/forms
/learning
/employee-app
/reports
/settings
```

Core manual workflow:

1. Create patient.
2. Book appointment.
3. Open Journey.
4. Save clinical note.
5. Create treatment service from odontogram/catalog.
6. Record progress.
7. Record patient payment and allocate to service.
8. Issue invoice.
9. Upload/open protected patient file.
10. Verify Dashboard task signals where applicable.

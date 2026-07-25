# Project Context

Last updated: 2026-07-25

## Product Direction

- UI product name: Codexdentist.
- Product: open-source, all-in-one dental clinic operating system for Viet Nam.
- Primary target: small and medium clinics that self-host on a local PC, server, or NAS.
- Hosted `codexdentist.com` provides the product site, installation docs, and isolated 24-hour demo workspaces.
- Long-term direction: community-maintained multi-clinic dental OS with optional hosted services.
- PostgreSQL is canonical when available; local/demo fallback must not make staff think writes were persisted.

## Current Runtime

- Local PC app: `http://127.0.0.1:3000`.
- Self-host distribution: `compose.selfhost.yml`, `install.ps1`, `install.sh`, and `scripts/codexdentist.mjs`.
- Public product/docs: `https://codexdentist.com`, `https://codexdentist.com/features`, and `https://codexdentist.com/docs`.
- Public demo: `https://demo.codexdentist.com`; each workspace is isolated and expires after 24 hours. Root-domain `/demo` remains a compatibility entry.
- Public odontogram prototype: `https://odontogram.codexdentist.com`; it provides an adult FDI chart with five independently selectable surfaces per tooth. Prototype state is browser-local and is not yet a patient clinical record.
- Public S22U tunnel target: `https://app.codexdentist.com`.
- S22U deploy uses `scripts/deploy-to-s22.ps1` and must preserve `.env`, database, and storage.
- Check `adb devices -l` before S22U work.

## Tenant And Auth

- `Organization` is the canonical tenant/system/chain model. Legacy `Chain` is backward compatibility only.
- `app.codexdentist.com` is the neutral/super-admin host.
- `demo.codexdentist.com`, `docs.codexdentist.com`, and `odontogram.codexdentist.com` remain reserved system hosts. The demo and odontogram hosts render their dedicated entry directly at `/`.
- Tenant staff should use tenant subdomains such as `bsthinh.codexdentist.com`.
- Super admin is an `OWNER` email in `SUPER_ADMIN_EMAILS`.
- Tenant-host login/reset must never authenticate or reset another tenant.
- Business data must scope by `organizationId` server-side; clinic records must also respect accessible clinic ids.
- Staff onboarding uses one-time setup links, not shared demo passwords.

## Roles

Core roles: `OWNER`, `AREA_MANAGER`, `CLINIC_MANAGER`, `DENTIST`, `HYGIENIST`, `FRONT_DESK`, `BILLING`, `PATIENT`.

Users can hold multiple active role assignments through `UserRoleAssignment`. Role assignments are the source of truth for authorization and can be organization-wide (`clinicId = null`) or clinic-scoped (`clinicId` set).

Staff job title/position lives in the staff profile (`StaffProfile.title`) and is not an access role. `User.role` is an internal compatibility field derived from the highest active access role, and should not be exposed as a user-facing selector.

Route access lives in `src/lib/permissions.ts`. Mutation permissions live in `src/lib/actions/permissions.ts`. UI role checks are presentation only. Server code should use permission helpers with the full session, not direct `session.role` checks, unless the logic is explicitly about legacy compatibility or patient self-scope.

## Product Modules

- Dashboard/task inbox
- Schedule
- Patients
- Journey chart
- Billing
- Accounting/reports
- Services
- Staff/payroll
- CRM
- Inventory/assets
- Pharmacy
- Forms/consent
- Learning
- Patient app
- Employee app
- Settings

## Journey Rules

- `/journey` is the patient chart center: one patient, one timeline.
- `/clinical` and `/treatment` intentionally render the unified Journey workspace.
- Required block order: `Thông tin hành chính`, `Thông tin khám`, `Odontogram`, `Mục tiêu và kế hoạch điều trị`, `Dịch vụ`, `Timeline`.
- Journey search belongs in the app-shell control row, not inside the administrative block.
- Timeline is chronological ascending and includes appointments, clinical notes, treatment, billing, files, forms, prescriptions, CRM, and internal comments.
- Odontogram lower FDI quadrant mapping is intentional. Verify lower teeth such as 38/48 and 37/47 before changing it.

## Billing Rules

- Billing separates receipt collection from invoice issuance.
- Patient payments first create receipt and unallocated balance.
- Allocations apply balance to treatment services.
- `Ghi nhận thu` records receipt/allocation only.
- `Ghi nhận thu và xuất hóa đơn` creates invoice only up to remaining uninvoiced service price; overpayment remains patient advance/unapplied balance.
- A Journey service can have multiple invoices. Do not merge issued partial invoices.
- Started services count as collection due only when progress is greater than `Planned (0%)`.
- Planned services may accept deposits but must not imply treatment started.
- Invoice UI should distinguish total service price from current partial invoice amount.

## Files And Storage

- Patient files are protected records, not public assets.
- Hosted production uses private Cloudflare R2. Self-host mode may use the private local volume mounted at `/data/patient-files`.
- Files are served through `/patient-files/[fileId]` with session, role, organization, clinic, and linked-patient checks.
- Upload storage validates size, declared type, file extension, and content signature before writing or image processing. Active HTML/SVG payloads are rejected.
- Demo workspaces cannot upload patient files or send outbound notifications.
- Virus scanning is a governance status until a provider/scanner is connected.

## Security Baseline

- Hosted production accepts only the configured root domain and one-level subdomains; self-host deployments additionally accept local/LAN hosts.
- Server Actions restrict allowed origins on hosted deployments.
- Login, password reset, and demo creation rate limits are stored in PostgreSQL and keyed by a hash; Cloudflare's verified client IP header takes precedence.
- Production `/api/readiness` requires `JOB_SECRET`. Public monitoring uses `/api/health`.
- Production CSP must not allow `unsafe-eval`.

## Services, Inventory, Payroll

- Service material norms live in `/services`.
- Procurement, lots, expiry, stock movements, suppliers, equipment, and maintenance live in `/inventory`.
- Journey progress can consume service materials automatically and create low-stock work items.
- Journey treatment service deletion is owner-only and only allowed while the service is still planned with no progress, invoice, receipt/allocation, or compensation history.
- Keep stock controls out of compact Journey service cards.
- Payroll is an audit MVP. It does not automatically calculate taxes, social insurance, base salary proration, or deductions.
- Source commission is based on collected cash, kept separate from clinical service compensation, and changes require manager reason/audit.

## AI And Notifications

- Owner-level AI should be read-only by default and use scoped, minimized context.
- AI writes require proposal/confirm, never direct DB mutation.
- `AiRun` should keep provider/model/error metadata while avoiding unnecessary PHI in logs.
- Job endpoints use `JOB_SECRET`; never expose it client-side.

## UI Rules

- Workflow UI must not mention PostgreSQL, database connectivity, demo mode, seed data, or server console.
- Use operational Vietnamese empty/error states.
- Shared statuses should render through localized helpers, not raw English enum values.
- Dense operational pages should keep primary workflows visible and move low-frequency tools into modal, drawer, tabs, or details.

## Current Queue

1. Publish the repository and container under the final GitHub owner.
2. Run a community beta with synthetic/demo data only.
3. Verify backup and restore on Windows and one Linux/NAS host.
4. Add release notes, upgrade compatibility checks, and a support intake process.
5. Continue Journey performance and dense-module UI passes without broad refactors.

## Module Readiness Gate

Every pilot-ready module should satisfy:

- Route loads with authenticated owner.
- Loader/action scopes by `organizationId`; clinic scope is server-enforced where relevant.
- Empty states are operational Vietnamese.
- Search/filter clear behavior is predictable.
- Primary actions validate input and show success/failure notice.
- Dangerous actions have confirmation.
- Mobile width does not break layout.
- `npm run typecheck` passes.

High-risk module specifics:

- Journey: no unintended auto-selected patient, timeline complete/chronological, odontogram mapping intact.
- Billing: receipts, allocations, invoices, refunds, credit balances, and partial invoices reconcile.
- Settings/Tenant: organization creation creates owner/defaults; tenant staff cannot log into wrong tenant; super admin writes into target org, not own org.

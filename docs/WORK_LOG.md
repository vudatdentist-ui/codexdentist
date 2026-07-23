# Work Log

Newest first. Keep this short; Git history is the detailed archive.

## 2026-07-23

- Prepared the public GitHub snapshot: removed personal super-admin/reset defaults and host-specific paths, added a private vulnerability-reporting policy, expanded secret/data ignores, upgraded vulnerable dependencies, and verified a clean Gitleaks scan plus zero npm audit findings.
- Moved the public demo entry to `https://demo.codexdentist.com/`, kept root `/demo` compatibility, added a feature-by-feature usage guide, and replaced the soft marketing crop with high-resolution screenshots captured from the live demo.
- Prepared and deployed the open-source beta at `codexdentist.com`: public product/docs pages, isolated 24-hour demo workspaces, hourly expiry cleanup, first-run self-host setup, Docker packaging, Windows/Linux installers, health/backup/update CLI, AGPL-3.0-or-later license, contribution guide, CI and container release workflows. Verified production demo onboarding, demo expiry cleanup preserving real organizations, and a disposable self-host install through dashboard and backup.

## 2026-07-14

- Deployed Codexdentist to Namecheap Stellar Plus at `codexdentist.com` with Node.js 22, cPanel Passenger startup, account-local PostgreSQL, HTTPS, R2-backed patient file configuration, migrations, seeded pilot data, deactivated demo-password accounts, and a one-time owner setup link. Added shared-host build worker limits and automatic Prisma Client generation for repeatable deploys.

## 2026-07-07

- Audited and tightened billing, services, inventory, notification notices, and patient-file QA: patient portal payments now create receipts/allocations, service deletion is owner-only with retire-on-history behavior, global inventory movements resolve a valid clinic, success notices are visible again, and the protected patient-file smoke uses the current smoke password.

## 2026-07-06

- Fixed staff password setup/reset links to use the tenant domain instead of the neutral app host, so clinic staff land back on their clinic login after setting a password.
- Fixed S22U billing receipt recording after reboot/build drift: rebuilt the phone app, hardened document numbering so an existing sequence is raised to at least the current persisted document count, and made S22 restart scripts track the real Codexdentist `next-server` process without touching other services on the phone.
- Hardened S22U reboot autostart: `start-codexmed` now launches both app and named tunnel watchdogs, watchdog scripts verify command lines before trusting stale PID files after reboot, and old executable boot backups were disabled on the phone to prevent duplicate launchers.

## 2026-07-04

- Recovered S22U PostgreSQL on Android 16 without resetting data: created a cold backup, built a local API 26 `libandroid-shmem` runtime, and routed S22U PostgreSQL start/watchdog scripts through it when present.

## 2026-06-30

- Added owner-only deletion for Journey treatment services, with server-side tenant/clinic permission checks and guards that block deletion once clinical or financial history exists.

## 2026-06-08

- Fixed `/schedule` provider recognition for multi-role staff: provider lists and schedule provider actions now honor active `DENTIST`, `HYGIENIST`, and `CLINIC_MANAGER` role assignments instead of relying only on legacy `User.role`; appointment actions now match the schedule UI permission set.
- Simplified `/settings` staff identity/access model: job title is now profile-only, access roles are managed through role assignment checkboxes, and `User.role` is auto-derived internally for compatibility instead of shown as a separate selector.
- Added multi-role, scoped RBAC: users now have `UserRoleAssignment` records for organization-wide or clinic-scoped access while `User.role` remains a compatibility field. Updated auth sessions, permission helpers, action checks, `/settings` staff access UI, and local migration backfill.

## 2026-05-30

- Made `/inventory` stock overview collapsible: low-stock, expiry-watch, stock-by-group, and each primary inventory group now collapse by default and expand on demand. Verified typecheck, encoding, build, route smoke, and targeted browser interaction.

## 2026-05-29

- Simplified `/inventory` entry UI: removed the money hint line under money fields, left unit empty by default, made supplier/equipment/item codes system-managed and hidden from user-facing inventory UI, and limited active inventory tags to dental specialties. Verified typecheck, encoding, build, route smoke, and targeted browser checks.
- Added safer money entry UX: money fields now format with thousand separators while typing and accept shorthand such as `500k`, `5m`, and `5tr`. Server parsing now also accepts formatted/shorthand money values. Applied to billing, accounting, services, inventory costs, journey discounts, and staff deduction money fields; no warning layer added.
- Reset demo inventory data around the new taxonomy: removed old demo items, lots, movements, purchase orders, equipment assets, suppliers, groups, and tags; seeded four primary groups (`Vật tư tiêu hao`, `Thiết bị`, `Dụng cụ`, `Thuốc tê và thuốc`) with item tags and no default suppliers. Verified encoding, typecheck, build, route smoke, and targeted browser checks.
- Reworked `/inventory` settings around primary groups plus multi-tag item labeling: added DB-backed item groups, inventory tags, item-tag links, item group assignment, tag assignment in item forms, and settings controls to add/disable groups, tags, and suppliers. Applied migration `20260529153000_inventory_category_settings`; verified encoding, typecheck, build, targeted browser check, route smoke, and full `browser:qa`.
- Fixed duplicate supplier display in `/inventory`: when supplier code and name are the same, supplier lists/dropdowns now show the value once instead of `NCC-MESI · NCC-MESI` or `NCC-MESI - NCC-MESI`. Verified encoding, typecheck, build, browser check, and route smoke.
- Fixed `/inventory` supplier entry from item forms: typing a new supplier name now creates a scoped supplier automatically and links it to the saved item; the supplier picker copy now says it can create a new supplier. Verified encoding, typecheck, build, targeted browser/DB save flow, and route smoke.
- Restructured `/inventory` into an operational workbench: tab actions now follow the active workflow, `NCC & đơn nhập` became `Nhập hàng`, `Nhập/xuất & lô` became `Lô & hạn dùng`, stock categories are summarized into eight larger operational groups, tab badges count primary objects, and `minimumStock = 0` no longer creates a low-stock alert. Verified encoding, typecheck, build, route smoke, targeted desktop/mobile browser checks, and full `browser:qa`.
- Rebuilt active documentation into six Markdown files: `AGENTS.md`, `README.md`, `docs/PROJECT_CONTEXT.md`, `docs/QA_PLAYBOOK.md`, `docs/OPERATIONS.md`, and this log. Deleted stale session plans, old harness docs, long refactor logs, split checklists, and S22 manual README after merging current content.
- Previous docs cleanup removed expired CLI/session plans, old audit/readiness/refactor logs, stale handoffs, and obsolete prompt files.

## 2026-05-28

- Started Docker Desktop/PostgreSQL without resetting data, confirmed `/api/health` ok, used production build/start after a Turbopack dev-server login panic, aligned route smoke with the smoke-user password default, and verified encoding, typecheck, agent health, browser QA, and route smoke.
- Fixed `/inventory` supplier save visibility, supplier section sync from `section` query param, and supplier list truncation.
- Polished `/inventory` item forms with category/unit suggestions, searchable supplier entry, and clearer lot/expiry tracking.
- Added `/journey` patient menu drawer from the topbar with today, in-treatment, collection-due, and recent patient groups.

## 2026-05-26

- Added `npm run browser:qa`, `npm run readiness:check`, `npm run test:data-integrity`, and `npm run pilot:qa`.
- Added pilot workflow, hardening, tenant, role, action-permission, billing, and data-integrity smoke coverage.

## 2026-05-24 to 2026-05-25

- Reworked `/billing` into patient-first workflow tabs and corrected receipt, credit-balance, statement, invoice, and collection math.
- Synced `/journey` service progress with `/services` steps and added billing receipts/payments to Journey timeline.
- Added UTF-8/mojibake guard, operational seed scripts, S22 deployment/seed flow, chair management, schedule UI actions, and app-wide action scroll preservation.

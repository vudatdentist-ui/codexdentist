# QA Playbook

Last updated: 2026-07-28

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
npm run test:billing-concurrency
npm run test:compensation
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
- `https://odontogram.codexdentist.com/` keeps the root URL; displays `Hiện trạng ban đầu` -> `Tình trạng hiện tại` -> `Kết quả kỳ vọng`; persists each stage independently in browser local storage; migrates an existing single snapshot into the initial/current stages; switches between 32 permanent and 20 primary FDI teeth; renders every generated anatomical SVG asset without fallback or distortion; exposes five surfaces through keyboard controls; shows M/D/B/L/O-I inside the large surface map without a duplicate list; limits surface colors to `Sâu răng`, `Mối hàn`, and `Inlay / Onlay`; keeps crown/root clicks as target selection without painting the tooth; renders the black caries clinical marker against the selected crown/root contour; supports compatible simultaneous clinical symbols per tooth; retains the bone/gum block for missing teeth; lowers that block when bone loss is added; labels the whole-mouth control `Đánh giá tổng quát`; persists gingiva, calculus, plaque, oral-hygiene, occlusion, arch findings, and notes for the appropriate scope; keeps tooth marks isolated by dentition; and has no horizontal overflow at `390x844`.
- Odontogram structural-state checks: marking a tooth missing removes its artwork and clears/disables its five surfaces; marking an implant replaces the tooth artwork and clears/disables surfaces; selecting a conflicting state removes the old state; one undo restores the complete pre-action tooth state.
- Odontogram anatomy check: crown/root zones are clicked directly on the current tooth artwork without rendering a second tooth image; fill, hover target, selection target, and outline must use the exact source contour and matching SVG viewBox for incisor, canine, premolar, molar, and the dedicated primary-tooth artwork. Selecting a zone records the active clinical target: root selection enables root-canal, periapical, fracture, and whole-tooth actions but disables crown-only actions; crown selection enables crown, fracture, and whole-tooth actions but disables root-only actions. Root versus crown fracture must render in the selected region and survive reload. Missing teeth and implants clear/disable both zones, and one undo restores the previous anatomy and target state.
- Odontogram data-model check: every saved snapshot is `version: 2` with bounded entries that separate concept, status, and target. A valid `version: 1` snapshot migrates without visible loss, invalid tooth/surface/region/span targets are rejected server-side, duplicate entry ids are rejected, and structurally valid unknown entries survive normalization and subsequent chart edits.
- Odontogram prosthetic check: an implant and its crown can be selected together in either order, both artwork layers remain visible, and removing either state preserves the other.
- Odontogram multi-select is always active and has no separate mode control. The initial state may contain no selected tooth. Clicking another tooth adds it, clicking a selected tooth removes it, and clicking the last selected tooth returns to an empty selection. Tooth-specific clinical markers and bridges stay disabled while selection is empty; clicking a tooth surface or anatomy region directly selects that tooth before applying the mark. Editing one surface preserves the selected group. A clinical marker must apply or remove atomically across all selected teeth, show a mixed state when only some selected teeth carry it, and undo as one action. The bridge control stays disabled for fewer than two teeth and invalid cross-arch or non-contiguous selections; a valid bridge persists, exports, renders across natural, implant, and pontic units, and can be removed without changing individual tooth markers.
- Journey odontogram stage check: the control order is `Hiện trạng ban đầu` -> `Tình trạng hiện tại` -> `Kết quả kỳ vọng`; a new patient starts at `INITIAL`, and the later stages unlock after the first save. `CURRENT` initially displays the initial state as a working base, while `EXPECTED` displays its saved state or the current state. The copy action is explicit and never changes the source stage.
- Journey odontogram persistence check: edit one distinguishable condition in each stage, wait for autosave, refresh, and verify all three snapshots remain different. Only the edited stage revision may increment; stale revision writes conflict rather than overwrite. Existing pre-migration charts must appear unchanged in both `INITIAL` and `CURRENT`, with `EXPECTED` empty. Select at least two teeth and verify `Bỏ chọn tất cả` changes no clinical data; `Xóa trạng thái` requires confirmation and removes every entry for the selected teeth plus intersecting bridges. Verify `Xóa mốc đang mở` changes only that stage, `Xóa cả 3 mốc` clears all stages, and both operations remain cleared after refresh.
- Journey odontogram integration check: selecting teeth updates temporary treatment targets without changing clinical marks or stage snapshots. The tooth/arch selection summary, diagnosis, service catalog, and add-service action stay directly below both arches inside the chart column. Switching stages clears the temporary tooth selection but does not collapse the planner. Creating treatment services may clear `PatientJourneyState.odontogramTeeth` but must not alter any `PatientOdontogram` stage or its revision history.
- Journey odontogram permission/isolation check: clinical roles can edit, front desk and billing are read-only, and an inaccessible clinic patient cannot read or write any stage.
- Odontogram general-assessment dialog check: at desktop, tablet, `390x844`, and `320x568`, the dialog stays inside the viewport without horizontal scrolling; long labels wrap and tall content scrolls vertically.
- Journey treatment-progress dialog check: long service names and step transitions wrap without squeezing the title or creating horizontal scrolling; form controls and actions remain inside the viewport at desktop, `390x844`, and `320x568`, with vertical scrolling only when needed.
- Journey clinical-plan check: `Thông tin hành chính` and `Khám và kế hoạch điều trị` share the top two-column layout on desktop. The clinical panel has no repeated section heading and ends with one `Thêm vào timeline` button. Submitting atomically creates one finalized exam event with prognosis and a goal/plan snapshot, updates the current journey goal/plan, and writes both audit records.
- Journey timeline check: finalized events remain chronological ascending and are grouped by Viet Nam calendar day; compact rows show time/type/title/status and reveal detail only when expanded. Unlocked clinical notes appear only in `Ghi chú chưa hoàn tất`; completing one requires confirmation, returns to the same patient, and moves it into the finalized timeline.
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

- Login and password reset use both network and account/token rate limits; spoofed proxy headers do not reset the account/token bucket.
- Credential notifications never store raw setup/reset URLs and never appear in the shared task inbox.
- Staff-management actions reject targets with an equal or higher effective role and preserve at least one active owner.
- CSV exports neutralize spreadsheet formula prefixes.
- `npm run test:security-runtime` verifies manager/owner hierarchy, credential-notification isolation, and atomic single-use password reset.
- Session cookie is `httpOnly`; production uses secure cookies.
- Demo auth/fallback is disabled in production.
- Every protected route uses session/view checks.
- Every mutation enforces action-level permission server-side.
- Every mutation fetches target resource by tenant scope before writing.
- Export routes check role and resource access.
- Patient portal is scoped only by `portalUserId`, never email; appointment and treatment-plan state transitions reject terminal/source-invalid records.
- Billing concurrency tests preserve both receipts without overpaying or over-allocating an invoice; ledger constraints and tenant-scope triggers are installed.
- Uploads enforce size, MIME, extension, storage, and unsafe scan status rules.
- Upload content signatures match declared image/PDF/video/Office types before storage.
- Production readiness rejects requests without `JOB_SECRET`.
- Unsupported HTTP methods and untrusted Host headers are rejected before route handling.
- Login throttling persists across application restarts.
- Billing void/refund requires role, reason, and audit.

Tenant negative tests to preserve:

- Org A cannot list/edit Org B patients, invoices, payments, or files.
- Tenant subdomain cannot authenticate a user from another tenant.
- Patient account cannot access another patient, including a patient in the same organization with the same email.
- Patient-file tests cover another organization, inaccessible clinic, `QUARANTINED`, and `INFECTED`.

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

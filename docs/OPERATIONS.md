# Operations

Last updated: 2026-07-23

## Local PC

```powershell
docker compose up -d
npm run test:seed-users
npm run dev
```

Production-mode local run:

```powershell
npm run build
npm run start
```

Health:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health
```

If port `3000` is busy, stop only this repo's Next process. Do not kill unrelated Node processes blindly.

## Community Self-Host

Requirements: Node.js 22 LTS, Docker Engine/Desktop with Compose, 4 GB RAM, and 10 GB free disk for a small clinic.

```powershell
.\install.ps1
npm run codexdentist -- doctor
npm run codexdentist -- backup
npm run codexdentist -- update
```

Linux/NAS uses `./install.sh`. The installer creates `.env.selfhost` with random secrets and starts `compose.selfhost.yml`. First-run configuration is available at `/setup` only while no organization exists.

Self-host storage:

- PostgreSQL: named volume `codexdentist-postgres`.
- Protected patient files: named volume `codexdentist-files`.
- Backups: `backups/codexdentist-<timestamp>/`.
- Copy backups off the server and run a restore drill before storing real patient data.

## S22U Deploy

Check device:

```powershell
adb devices -l
```

Deploy:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-to-s22.ps1
Invoke-WebRequest -UseBasicParsing https://app.codexdentist.com/api/health
```

Rules:

- Do not deploy unless ADB sees the intended phone.
- Do not reset DB during deploy.
- Do not overwrite `.env`.
- Preserve S22U database and storage.
- Known non-blocking build warning: dynamic dependency in `src/lib/patient-file-storage.ts`.

Manual Termux fallback:

```sh
cd ~/codexmed-os
bash tools/s22-termux/keep-codexmed-alive.sh
bash tools/s22-termux/keep-named-tunnel-alive.sh
curl http://127.0.0.1:3000/api/health
```

Reinstall reboot autostart:

```sh
cd ~/codexmed-os
bash tools/s22-termux/install-boot-autostart.sh
```

Termux:Boot must be installed, opened once, and allowed to run in the background. The boot script starts both the app watchdog and named Cloudflare tunnel watchdog. PID files are only trusted when the process command line matches the expected watchdog/tunnel/server process.

Android 16 PostgreSQL fallback:

- If PostgreSQL hangs in `unix_stream_data_wait` and health reports database unavailable, do not reset the DB or change `DATABASE_URL`.
- Build the local Android API 26 shared-memory runtime once:

```sh
cd ~/codexmed-os
bash tools/s22-termux/build-android-shmem-api26.sh
bash tools/s22-termux/keep-codexmed-alive.sh
```

- The S22U start/watchdog scripts use `$HOME/libandroid-shmem-api26/libandroid-shmem.so` for PostgreSQL when it exists.

Phone backups live under `Download/codexmed-backups/` when using `tools/s22-termux/backup-codexmed.sh`.

## Namecheap Shared Hosting

Current cPanel deployment:

- Domain: `https://codexdentist.com`
- Node.js app root: `/home/CPANEL_USER/codexdentist-app`
- Runtime: Node.js 22, production mode
- Startup file: `server.cjs`
- Database: account-local PostgreSQL; keep credentials only in `.env` and `.env.production`

Stellar Plus limits process creation during builds. Set `CODEXMED_SHARED_HOST_BUILD=true` so Next.js uses one build/static-generation worker, then deploy with:

```sh
source /home/CPANEL_USER/nodevenv/codexdentist-app/22/bin/activate
cd /home/CPANEL_USER/codexdentist-app
npm ci --include=dev --no-audit --no-fund
npm run build
set -a && source .env && set +a
npx prisma migrate deploy
```

Restart the app from cPanel `Setup Node.js App`, then verify `https://codexdentist.com/api/health`. Do not enable notification cron jobs until the delivery provider and recipient data have been verified. Shared hosting remains a pilot/community-test target; monitor cPanel resource usage before placing real clinic workloads on it.

Public host routing:

- root/`www`: product site, feature guide at `/features`, and compatibility demo entry at `/demo`;
- `demo`: 24-hour demo entry directly at `/`;
- `docs`: redirects to `/docs`;
- `app`/`admin`: neutral application entry;
- other supported subdomains: tenant application.

## Production Environment

Required:

- `DATABASE_URL`: managed PostgreSQL, not localhost.
- `APP_BASE_URL`: final HTTPS URL.
- `AUTH_SECRET`: unique random value, at least 32 characters.
- `JOB_SECRET`: unique random value, at least 32 characters.
- `DEMO_AUTH_ENABLED=false`.
- `PATIENT_FILE_STORAGE_DRIVER=r2`.
- `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus `R2_ACCOUNT_ID` or `R2_ENDPOINT`.
- Notification provider webhooks and signing secrets before real reminders are enabled.

New staff accounts use one-time setup links from `/settings`; links expire after 24 hours. Shared passwords such as `demo1234` must not be active for real staff.

## Jobs

Call with `POST` plus `x-job-secret: <JOB_SECRET>` or `Authorization: Bearer <JOB_SECRET>`.

- `/api/jobs/notifications`: every 5 minutes.
- `/api/jobs/recalls`: daily before clinic opening.
- `/api/jobs/demo-cleanup`: hourly on the public demo host.

Failed notification webhooks become `FAILED` rows and should be retried/triaged from Dashboard.

Demo cleanup requires `DEMO_WORKSPACE_ENABLED=true`, a strong `JOB_SECRET`, and a scheduled `POST` request. Send an empty JSON body with `Content-Type: application/json` on Namecheap/LiteSpeed so the request is not rejected before it reaches Next.js. Demo organizations are marked by `Organization.isDemo`; never purge organizations by slug/name pattern.

## Backup And Restore

Local backup:

```powershell
npm run backup:postgres
```

Restore:

```powershell
powershell -File scripts/pg-restore.ps1 -BackupPath <dump> -ConfirmRestore
```

Pilot policy:

- Daily backups.
- Keep at least 14 daily backups.
- Keep one weekly backup for 8 weeks.
- Copy S22U backups off-device.
- Run one restore drill before real patient onboarding and after migration batches.

Restore drill:

1. Create a fresh backup first.
2. Restore into a disposable database.
3. Point staging `.env` to the restored database.
4. Run `npm run typecheck`, `npm run test:smoke`, `npm run test:billing`, and `npm run agent:health`.
5. Only restore over active data after the disposable restore is verified.

## Go-Live Gate

Run before connecting real patient data:

```powershell
npm run encoding:check
npm run typecheck
npm run build
npm run test:smoke
npm run test:roles
npm run test:actions
npm run test:tenant
npm run test:hardening
npm run test:billing
npm run test:patient-files
npm run browser:qa
npm run go-live:check
```

Go-live is blocked by:

- cross-tenant data access;
- missing action-level permission on mutation;
- failed auth/session/password reset flow;
- billing reconciliation mismatch;
- unauthorized file access;
- demo fallback in production;
- no verified backup/restore drill;
- active users still accepting `demo1234`.

## Manual Pilot Smoke

- Owner login.
- Clinic manager login.
- Dentist login.
- Front desk login.
- Billing login.
- Patient login where enabled.
- Create patient.
- Book/check in appointment.
- Create/sign clinical note.
- Create Journey treatment service and record progress.
- Record patient payment to balance.
- Allocate balance to service.
- Issue invoice and print/export.
- Open patient file through protected route.
- Verify patient portal sees only own data.

## Mobile/PWA

Current mobile path is PWA first:

- `/patient-app`
- `/employee-app`

Do not package patient data into an offline static app. Native Capacitor wrapper should point to the deployed HTTPS app after PWA flows are stable.

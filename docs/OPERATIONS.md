# Operations

Last updated: 2026-07-25

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

Windows requirements: Windows 10/11 64-bit, WSL 2, Node.js 22 LTS, Docker Desktop with Compose, 8 GB RAM, and 20 GB free disk. Linux/NAS may start at 4 GB RAM and 10 GB free disk, but 8 GB RAM is recommended.

```powershell
.\install.ps1
npm run codexdentist -- doctor
npm run codexdentist -- backup
npm run codexdentist -- update
```

Linux/NAS uses `./install.sh`. The installer creates `.env.selfhost` with random secrets and starts `compose.selfhost.yml`. First-run configuration is available at `/setup` only while no organization exists.

To install on a non-default port, set `CODEXDENTIST_PORT` before running the installer. The value must be between 1 and 65535.

Self-host storage:

- PostgreSQL: named volume `codexdentist-postgres`.
- Protected patient files: named volume `codexdentist-files`.
- Backups: `backups/codexdentist-<timestamp>/`.
- Copy backups off the server and run a restore drill before storing real patient data.

## Namecheap Shared Hosting

### Automatic deploy from GitHub `main`

The repository deploys to the Namecheap cPanel app after a successful commit to
`main` through `.github/workflows/deploy-namecheap.yml`. The workflow uploads a
source archive over SSH, builds in a temporary directory, runs Prisma migrations,
updates only application files, and restarts the existing CloudLinux Node.js app.
It never reads, replaces, or commits the production `.env`, PostgreSQL data,
protected files, backups, or the physical `node_modules` directory.

Configure these GitHub repository secrets once:

| Secret | Value |
| --- | --- |
| `NAMECHEAP_HOST` | `premium277.web-hosting.com` |
| `NAMECHEAP_PORT` | `21098` |
| `NAMECHEAP_USER` | cPanel account username |
| `NAMECHEAP_APP_ROOT` | `/home/CPANEL_USER/codexdentist-app` |
| `NAMECHEAP_DOMAIN` | `codexdentist.com` |
| `NAMECHEAP_SSH_KEY` | Private Ed25519 key used only by GitHub Actions |
| `NAMECHEAP_KNOWN_HOSTS` | Pinned `ssh-keyscan` output for the host and port |

In cPanel, import the matching public key under **SSH Access → Manage SSH
Keys**, authorize it, and confirm that the key can run a non-interactive command.
Do not put `.env`, database credentials, R2 credentials, or a cPanel password in
GitHub. A failed deploy does not run `start` on a different application or touch
S22U.

The deploy workflow performs a public `/api/health` check after restart. The
hourly production-health workflow remains separate and continues to monitor the
public site and database.

Current cPanel deployment:

- Domain: `https://codexdentist.com`
- Node.js app root: `/home/CPANEL_USER/codexdentist-app`
- Runtime: Node.js 22, production mode
- Startup file: `server.cjs`
- Database: account-local PostgreSQL; keep credentials only in `.env` and `.env.production`

Authoritative DNS is Cloudflare, using `kanye.ns.cloudflare.com` and `tara.ns.cloudflare.com`. Edit public DNS in Cloudflare, not the cPanel zone or Namecheap Advanced DNS. Root, `www`, and `*` are proxied to the shared-hosting origin; mail and cPanel service hosts remain DNS-only. Preserve the Jellyfish MX records and the existing hosting SPF/DKIM/DMARC records when changing DNS.

Cloudflare SSL mode is `Full (strict)`. cPanel has a Cloudflare Origin CA certificate covering `codexdentist.com` and `*.codexdentist.com`; keep the wildcard certificate installed before changing TLS settings or moving the origin. Cloudflare also has one active rate-limiting rule named `Protect authentication endpoints`: requests from the same IP exceeding 30 `POST` requests in 10 seconds to `/login`, `/reset-password`, or `/demo` are blocked for 10 seconds. Application-level persistent rate limits remain authoritative for credential abuse.

The cache rule `Cache public odontogram shell` applies only to `odontogram.codexdentist.com/` with a one-hour edge TTL and `Browser TTL: Bypass cache`. The app also declares `Cache-Control: no-store, max-age=0, must-revalidate` for that host/root; Cloudflare's browser-TTL override is authoritative because LiteSpeed may replace the origin `max-age`. The resulting public response must remain `no-store` while Cloudflare may retain its forced edge copy. After each shared-host deployment, purge that exact URL in Cloudflare, request it once to warm the new HTML, then verify a non-empty `MISS` followed by non-empty `HIT` responses. Do not broaden this rule to authenticated app routes or patient data.

Stellar Plus limits memory and process creation during builds. Stop only this Node.js app before installing dependencies, use one Next.js worker, and prune development dependencies before starting it again:

```sh
cloudlinux-selector stop --json --interpreter nodejs --domain codexdentist.com --app-root codexdentist-app
cd /home/CPANEL_USER/codexdentist-app
NODE_BIN=/opt/alt/alt-nodejs22/root/usr/bin
export PATH="$NODE_BIN:$PATH"
"$NODE_BIN/npm" ci --include=dev --ignore-scripts --no-audit --no-fund
"$NODE_BIN/npm" run prisma:generate
CODEXMED_SHARED_HOST_BUILD=true "$NODE_BIN/npm" run build
PUBLIC_ROOT=/home/CPANEL_USER/codexdentist.com
mkdir -p "$PUBLIC_ROOT/odontogram-assets" "$PUBLIC_ROOT/api/odontogram-assets"
cp -a public/odontogram-assets/. "$PUBLIC_ROOT/odontogram-assets"/
cp -a public/odontogram-assets/*.svg "$PUBLIC_ROOT/api/odontogram-assets"/
set -a && source .env && set +a
"$NODE_BIN/npx" prisma migrate deploy
"$NODE_BIN/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund
cloudlinux-selector start --json --interpreter nodejs --domain codexdentist.com --app-root codexdentist-app
```

The current app root uses a physical `node_modules` directory. Do not activate the Node Selector virtual environment before npm commands: its npm wrapper rejects a physical application-level `node_modules`. Recheck `ls -ld node_modules` after any hosting migration before changing this rule.

Shared hosting has an inode quota. After a successful deployment and health check:

- delete the uploaded release archive and its extracted staging directory;
- run `npm cache clean --force`;
- remove only the rebuildable `.next/cache` directory, never `.next/server` or `.next/static`;
- keep database dumps, environment backups, and compressed source bundles, but never back up `node_modules` or a full `.next` directory;
- review `du --inodes -x -d1 /home/CPANEL_USER | sort -nr | head` and keep total inode usage below the hosting warning threshold.

If the CLI start fails, start the app from cPanel `Setup Node.js App`. Then verify `https://codexdentist.com/api/health`. Do not enable notification cron jobs until the delivery provider and recipient data have been verified. Shared hosting remains a pilot/community-test target; monitor cPanel resource usage before placing real clinic workloads on it.

LiteSpeed/Passenger can retain a stale public-file index and old `lsnode` workers after deployment. Generated odontogram variants use the allowlisted `/api/odontogram-assets/[fileName]` route, and the release procedure also copies public SVGs into the domain document root so LiteSpeed can serve either path. Verify one base and one variant URL after each release. If a build stalls at `Collecting page data` with `fork: Resource temporarily unavailable`, close the build terminal to release its process tree before retrying; do not start another concurrent build.

After dependency changes, verify the installed runtime rather than only `package.json`:

```sh
npm ls next sharp --depth=0
npm audit --omit=dev
```

Production `/api/readiness` requires `x-job-secret: <JOB_SECRET>` or a Bearer token. Do not put this secret in public uptime monitors.

Public host routing:

- root/`www`: product site, feature guide at `/features`, and compatibility demo entry at `/demo`;
- `demo`: 24-hour demo entry directly at `/`;
- `docs`: redirects to `/docs`;
- `odontogram`: rewrites `/` internally to the standalone five-surface odontogram prototype;
- `app`/`admin`: neutral application entry;
- other supported subdomains: tenant application.

Production availability is checked hourly by `.github/workflows/production-health.yml`. It verifies the product page, feature guide, demo entry, application health, and database health. A failed run is an operational alert and must be investigated before release or onboarding.

GitHub health checks do not expose cPanel resource exhaustion. Review CPU, memory, process, disk, PostgreSQL size, and error logs in cPanel at least weekly during the public beta.

## Production Environment

Required:

- `DATABASE_URL`: managed PostgreSQL, not localhost.
- `APP_BASE_URL`: final HTTPS URL.
- `AUTH_SECRET`: unique random value, at least 32 characters.
- `JOB_SECRET`: unique random value, at least 32 characters.
- `TRUSTED_PROXY_PROVIDER`: `cloudflare` only when the origin accepts traffic through Cloudflare; use `reverse-proxy` for a controlled local proxy and `none` for direct access.
- `DEMO_AUTH_ENABLED=false`.
- `PATIENT_FILE_STORAGE_DRIVER=r2`.
- `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus `R2_ACCOUNT_ID` or `R2_ENDPOINT`.
- Notification provider webhooks and signing secrets before real reminders are enabled.

New staff accounts use one-time setup links from `/settings`; links expire after 24 hours. Shared passwords such as `demo1234` must not be active for real staff.

Self-host HTTP is suitable only on a trusted, isolated LAN. For guest Wi-Fi, shared networks, remote access, or real patient data crossing untrusted devices, terminate TLS at a controlled reverse proxy and set `SESSION_COOKIE_SECURE=true`; do not expose port 3000 directly to the Internet.

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
- Copy production backups outside the Namecheap hosting account.
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

# Operations

Last updated: 2026-11-09

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

Hosted private local storage is opt-in: set `PATIENT_FILE_LOCAL_DURABLE=true`,
`PATIENT_FILE_STORAGE_ROOT=/data/patient-files` and, only after acceptance,
`PATIENT_FILE_STORAGE_DRIVER=local`. Mount one named volume with label
`com.codexdentist.storage=patient-files`, owned by UID/GID 1000 and mode 0700,
using Compose long-form `volume: { nocopy: true }`. Docker can otherwise copy
image-directory permissions over an empty volume on its next attachment. The
application rejects root-owned, public, read-only, symlinked, temporary or
unmounted durable roots. Never put the file root in a release or public directory.

Install reviewed copies of `scripts/patient-file-backup.py`,
`scripts/deploy-hostinger.py` and `scripts/production-go-live.py` outside release
checkouts before enabling the flag. The deployer briefly pauses only the clinic
app for its coordinated database/file snapshot and always unpauses it after a
dump/archive failure. Restore verification runs afterward without workers or
network access. The file helper checks volume ownership, private modes, archive
paths and every restored checksum; it removes only its labelled disposable
restore volume. Retain the original release backup and private snapshots. The
independent go-live process uses the exact image, resolved environment and app
UID, mounting only the patient's named file volume for its write probe. Never
use root or an ephemeral image path to make this check pass.

For the reviewed R2 original, run `scripts/migrate-owned-patient-file.mjs` through
the TypeScript alias loader as the app UID, with explicit `--organization <id>`
and `--file <id>`. Without `--apply` it only reports eligibility. The apply path
preserves the R2 source, fsyncs a private `.migrations` journal and checked local
copy, then transactionally changes storage metadata, the single cleanup stage
and the audit record. A failed or uncertain commit retains its candidate for a
reviewed retry; do not delete it or mark it for GC. The current command rejects
unchecksummed files and originals with variants. Preserve historical R2 keys for
mixed reads until all asset classes and rollback are accepted. Rollback must keep
the durable root/volume mounted whenever any record references local bytes;
changing the default write driver back to R2 does not relocate those records.
Use the reviewed deployer's `--backup-only` under the same deployment lock for
nightly snapshots. It backs up the actual running revision even if GitHub is
unavailable or a newer main exists, verifies isolated database and file restores,
and writes `backup-verified.json` only after success. It never changes the release
marker, application configuration or image. Install a dedicated root-owned systemd
timer after a successful manual run; preserve all existing backups and deploy timers.

Production acceptance (2026-11-09, `88a6244`, PR #97): the active writer is local,
with `codexdentist-private-patient-files` mounted at `/data/patient-files`.
The existing 41,744-byte original and its cleanup stage moved together; protected
downloads, unchanged clinical metadata and the retained R2 checksum were verified
before and after changing the default writer. Go-live/public HTTP/readiness and
the financial/login-mapping audit passed. Release rollback snapshot:
`/opt/codexdentist-deploy/backups/20261109T141550Z-88a6244b84d8`.
The pre-migration coordinated snapshot is `20261109T141951Z-periodic-88a6244b84d8`;
the complete local-data snapshot is `20261109T142337Z-periodic-88a6244b84d8`.
Both have isolated database/file restore evidence. Keep the durable mount and
flag during rollback whenever current records reference local storage.

`codexdentist-data-backup.timer` runs daily from 19:30 UTC (about 02:30 Bangkok),
with up to five minutes of randomized delay. Its first manual service run passed
before enabling the timer. The reviewed wrapper and public-recipient sealing
helpers live under `/opt/codexdentist-deploy/durable-files-review-20261109`;
`/opt/codexdentist-deploy/last-periodic-sealed-backup.json` identifies the latest
successful archive. They call the canonical `--backup-only`, then create a
streamed CMS AES-256-GCM/RSA-OAEP-SHA256 envelope using only the public recipient
certificate. Logs and source backups stay root-private. The private recipient
key is retained in an ACL-protected directory on the owned Windows PC, outside
Git, and was never uploaded to the VPS. Preserve it separately from the encrypted
archives. Cross-version decryption and a modified-ciphertext rejection were tested.

The complete encrypted snapshot was copied off-server and decrypted only in
memory: the dump header, exact archive hash and every private object's SHA-256,
size, ownership and mode match. The local private backup directory also contains
a non-sensitive `.restore-proof.json`. The timer creates encrypted server copies;
off-server transfer is a separate operator step and is not scheduled on the PC.
Review sessions created for acceptance were revoked individually, and their
temporary cookie exports removed; existing user sessions/passwords were preserved.

## Hosted Deployment

Owned email (pending production activation): `scripts/owned-mail-services.py`
prepares an explicit exact-release gateway image plus pinned Maddy 0.9.6 under
`/opt/codexdentist-owned-mail`. `prepare --base-image codexdentist:<40-hex-SHA>
--hostname <verified-outbound-hostname>` refuses an existing installation or
volume instead of overwriting state. TLS keys, a separate signing secret and
separate payload-encryption key stay private, outside the app/vault master.
`up` initially starts only isolated internal networks and test-restricted
services, with no published SMTP/IMAP/HTTP port and no outgoing mail route.
`status` verifies image pins, non-root/read-only isolation and network membership.
The SMTP journal and queue require their own stopped-worker snapshot/restore
before outgoing mail is enabled; core PostgreSQL backup alone is insufficient.

The app transport requires `NOTIFICATION_DELIVERY_MODE=owned-mail`,
`OWNED_MAIL_BASE_URL=https://codexdentist-mail-gateway:3443`, the exact gateway
signing secret and a plain sender in `OWNED_MAIL_FROM`. Mount only the public
gateway certificate into the core and set `NODE_EXTRA_CA_CERTS` before Node
starts; never disable certificate validation. Preserve Resend and the existing
mail/DNS configuration until sender SPF/DKIM, queue restore, credential recovery
and delivery are accepted. The existing `mail.codexdentist.com`/MX records serve
the older inbound mailbox and must not be overwritten to add outgoing mail.
The VPS's public forward-confirmed PTR hostname can be used for outbound HELO
without replacing inbound DNS. Add the VPS IP to the existing SPF rather than
creating a second SPF record, and add only the new DKIM selector's public key.

Gateway receipts bind organization and notification IDs. The core keeps an
uncertain request PROCESSING; subsequent immediate/batch processing reads its
authenticated status without re-posting content. SENT means the MTA accepted
the message, as with the previous provider's acceptance; external inbox
placement is verified separately. A lost SMTP DATA acknowledgement remains
UNCERTAIN and needs operator evidence. Preserve that journal/lease; do not
delete it or resend manually under a new ID to hide uncertainty. Restores run
without workers/network and must not resume ambiguous jobs automatically.

### Hostinger migration observed 2026-10-21

The public domain currently points through Cloudflare to the Hostinger VPS at
`187.127.116.53`. The running app is the `codexdentist` service in
`/opt/namecheap-migration/compose.yml`, outside Coolify's managed projects.
The Namecheap procedure below describes the previous deployment target; verify
the active target before deploying a GitHub release there.
The historical Namecheap deploy workflow now requires the repository variable
`ENABLE_NAMECHEAP_DEPLOY=true`; leave it unset for the current VPS target.
Hostinger image replacement is a separate operation and must preserve the
existing Compose environment, networks, database, and rollback image.

### Current Hostinger deployment

The reviewed pull deployer is `scripts/deploy-hostinger.py`, installed as a
root-owned copy at `/opt/codexdentist-deploy/deploy-hostinger.py`. Its systemd
service/timer templates are beside it in `scripts/`. The timer checks every
30 minutes after the previous run finishes. It uses public GitHub reads, requires
successful **push CI for the exact current main SHA**, and grants no GitHub or
inbound webhook access to the VPS. The installed deployer never updates itself;
review and explicitly install changes to deployment policy.

Each release builds an image from a clean exact-commit checkout, validates the
entire migration range since the deployed revision, saves the existing Compose,
environment files and a custom-format PostgreSQL dump in a private timestamped
backup directory, then restores that dump into an isolated temporary PostgreSQL
container and applies the candidate migrations there. Unattended migration policy
accepts only new CREATE statements; edited migrations and other SQL require an
operator review even if CI's broader expand/contract checker passes.

The application keeps its existing runtime database identity. DDL uses the
PostgreSQL container's separate bootstrap migration principal, read in memory
from the root-only Docker configuration and verified over TCP before migration.
That identity must match the superuser privilege class used by the isolated
restore. Its URL is forwarded only to the short-lived migration process through
the child environment; never put it in command arguments, Compose, a candidate,
the application or a release marker. Default privileges give the runtime role
CRUD on newly created tables and usage/select on new sequences; they do not give
it core-table REFERENCES, DDL or elevated roles. The restore drill also verifies
a limited NOLOGIN runtime role can access the resulting tables. Run
`test:migration-role-db` on disposable loopback PostgreSQL after changing this
boundary: restoring as superuser alone does not prove runtime migrations work.

For a partially failed migration, keep the attention marker and inspect actual
objects, row counts, ownership, constraints and migration history first. A
reviewed recovery may complete only the missing statements from the exact
canonical SQL, then use `prisma migrate resolve --applied` with the migration
principal. Do not edit historical SQL, reset data or mark incomplete DDL applied.
Retain a fresh backup and restore rehearsal. Archive the resolved marker only
after schema/history, runtime grants and old/candidate health are verified.

For a reviewed additive migration batch, use `--reviewed-migrations <file>` on
the installed deployer. The JSON file must be root-owned, not group/world
writable, and contain `sha`, `previous`, and `migrations` (a map of every new
`prisma/migrations/.../migration.sql` path to its SHA-256). Pin both full revisions
to the candidate and currently deployed image, and hash Git's exact SQL bytes.
Review the complete range and constraints before writing the manifest; historical
migration edits remain forbidden. The normal timer does not receive this override.
Successful exact-main push CI, backup, isolated restore, candidate health and
rollback checks remain mandatory for a manually reviewed release.

Production migration runs with the candidate image and the existing Compose
environment while the previous application remains available. A candidate on a
Docker-allocated loopback port must pass health/schema and public-route checks
before cutover; it must not claim a fixed port used by another VPS application.
Only the `codexdentist` image line is changed in the original Compose file; the
deployer recreates only that service with `--no-deps --pull never`. Verification
checks loopback port 3100, public HTTPS, and the running image's commit label.
Old images and database/configuration backups are retained; patient files remain
in the existing R2 bucket and are neither copied to releases nor overwritten.

After a cutover failure, the previous exact image is restored and checked. The
additive database migration is retained: never restore an old dump automatically
over newer writes. Any failure after production migration begins retains
`/opt/codexdentist-deploy/needs-attention.json`, blocking further deployments.
Inspect the backup, migration state, service logs and health before resolving that
marker. A failed rollback must remain unresolved. Never remove a marker merely
to force a retry.

```sh
systemctl status codexdentist-deploy.timer
journalctl -u codexdentist-deploy.service -n 80 --no-pager
python3 /opt/codexdentist-deploy/deploy-hostinger.py --check
systemctl start codexdentist-deploy.service
```

The first deployment from an unlabelled legacy image must be performed manually
with the same backup/restore, migration, candidate and rollback checks. Automatic
deployment refuses to infer its source revision. Run `python3
scripts/deploy-hostinger.test.py` after deployment-policy changes. Before storing
real clinic records, copy backups to a separately protected destination and test
R2 object recovery as well as PostgreSQL restoration.

The signup route must render dynamically: availability depends on runtime
`DEPLOYMENT_MODE` / `TRIAL_SIGNUP_ENABLED`. An image built with signup disabled
must not cache a permanent 404 when started in hosted mode. Verify `/signup`
after building with the self-host defaults and starting with signup enabled.
Keep the disabled runtime setting returning 404 as an emergency kill switch.

### Historical Namecheap Deployment (inactive)

The procedures below describe the previous shared-host target. They are not the
current production release path. Leave `ENABLE_NAMECHEAP_DEPLOY` unset; use the
Hostinger procedure above for `codexdentist.com`.

When explicitly enabled for that historical target, `.github/workflows/deploy-namecheap.yml` downloads the successful main run's verified hosted release archive and uploads it over SSH. It stages the archive separately, installs dependencies, generates Prisma, runs backward-compatible migrations while the old application remains live, and prunes development dependencies. It stops only the existing CloudLinux Node.js app for the final file cutover; it does not build Next.js on the hosting server.

The deploy script never replaces the production `.env`, protected patient files, or backups. It copies `.env` into the isolated staging directory for preparation; before Prisma migration it parses and exports only `DATABASE_URL` from that protected file with the pinned Node.js 22 runtime. A missing `DATABASE_URL` aborts before migration or application stop. This explicit load is required because Prisma ORM v7 evaluates `prisma.config.ts` from process environment rather than implicitly loading the project's `.env`. A fresh physical `node_modules` tree is prepared in staging and promoted with the application. PostgreSQL migrations are explicit database changes, not a reset or data replacement.

CI must package and boot the extracted archive on pull requests as well as `main`. It checks `server.cjs` with production-only dependencies, health/database/schema, and login. Only a successful push to `main` uploads the production artifact. From a clean, built CI checkout with synthetic test data:

```sh
node --test scripts/package-release.test.mjs scripts/deploy-namecheap.test.mjs
node scripts/package-release.mjs "$GITHUB_SHA" "$RUNNER_TEMP/codexdentist-artifact/release.tar.gz"
```

The packager uses explicit runtime inputs, excludes environment files, patient storage/backups, QA output and build caches, and verifies SHA/build identity from the archive before publishing. Never package a live application directory: generated pages can contain application data. The deployment regression tests simulate host commands and filesystem failures; they do not replace a real hosting or database restore drill.

If rollback cannot stop the app, restore a file, or restart the restored app, the script retains rollback/staging state and exits unsuccessfully. Any remaining `.codexdentist-rollback-*` directory blocks another deployment, including retries with a different SHA. Do not delete it to bypass the guard. Stop only the affected app, preserve a separate copy of the remaining recovery files and `.promoted-items`, reconcile restored and pending entries, then verify health and routes. Remove the resolved rollback marker only after recovery is verified; otherwise retain it and investigate the filesystem or hosting failure.

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

In cPanel, import the matching public key under **SSH Access → Manage SSH Keys**, authorize it, and confirm that the key can run a non-interactive command. Do not put `.env`, database credentials, R2 credentials, or a cPanel password in GitHub. A failed deploy must not start or mutate any unrelated application.

The deploy workflow performs a public `/api/health` check after restart. The hourly production-health workflow remains separate and continues to monitor the public site and database.

Historical cPanel deployment:

- Domain: `https://codexdentist.com`
- Node.js app root: `/home/CPANEL_USER/codexdentist-app`
- Runtime: Node.js 22, production mode
- Startup file: `server.cjs`
- Database: account-local PostgreSQL; keep credentials only in `.env` and `.env.production`

The previous DNS setup used Cloudflare with `kanye.ns.cloudflare.com` and `tara.ns.cloudflare.com`, proxying root, `www`, and `*` to shared hosting. That origin description is historical; verify current DNS and the Hostinger origin before changing routing. Preserve existing mail records when changing DNS.

Cloudflare SSL mode is `Full (strict)`. cPanel has a Cloudflare Origin CA certificate covering `codexdentist.com` and `*.codexdentist.com`; keep the wildcard certificate installed before changing TLS settings or moving the origin. Cloudflare also has one active rate-limiting rule named `Protect authentication endpoints`: requests from the same IP exceeding 30 `POST` requests in 10 seconds to `/login`, `/reset-password`, or `/demo` are blocked for 10 seconds. Application-level persistent rate limits remain authoritative for credential abuse.

The cache rule `Cache public odontogram shell` applies only to `odontogram.codexdentist.com/` with a one-hour edge TTL and `Browser TTL: Bypass cache`. The app also declares `Cache-Control: no-store, max-age=0, must-revalidate` for that host/root; Cloudflare's browser-TTL override is authoritative because LiteSpeed may replace the origin `max-age`. The resulting public response must remain `no-store` while Cloudflare may retain its forced edge copy. After each shared-host deployment, purge that exact URL in Cloudflare, request it once to warm the new HTML, then verify a non-empty `MISS` followed by non-empty `HIT` responses. Do not broaden this rule to authenticated app routes or patient data.

For an emergency manual rebuild only, Stellar Plus limits memory and process creation during builds. Normal CI-artifact deployment does not run this build sequence. Stop only this Node.js app before installing dependencies, use one Next.js worker, and prune development dependencies before starting it again:

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

### Shared Hosted Runtime Checks

Production `/api/readiness` requires `x-job-secret: <JOB_SECRET>` or a Bearer token. Do not put this secret in public uptime monitors.

Public host routing:

- All staff accounts use `https://codexdentist.com/login`; set `APP_BASE_URL=https://codexdentist.com` for recovery and invitation links. Organization scope remains server-enforced. The host-only `codexdentist_session` cookie replaces the legacy shared-domain cookie and requires users to sign in again once after deployment.
- root/`www`: product site, hosted trial signup at `/signup`, feature guide at `/features`, and compatibility demo entry at `/demo`;
- `demo`: 24-hour demo entry directly at `/`;
- `docs`: redirects to `/docs`;
- `odontogram`: rewrites `/` internally to the standalone odontogram entry;
- `app`/`admin`: neutral application entry;
- legacy workspace subdomains and `app`/`www` page links redirect to the root application with the path/query preserved (the subdomain root opens `/login`). API/webhook POST requests retain their scoped routing; dedicated service hosts remain separate.

Production availability is checked hourly by `.github/workflows/production-health.yml`. It verifies the product page, hosted signup page, feature guide, demo entry, application health, and database health. A failed run is an operational alert and must be investigated before release or onboarding.

Public health checks do not replace VPS resource monitoring. Review CPU, memory,
processes, disk, PostgreSQL size, container logs and deployment timer failures
during the public beta.

## Production Environment

Required:

- `DEPLOYMENT_MODE=hosted`: enables the hosted product surface, including public trial signup. Set `TRIAL_SIGNUP_ENABLED=false` only as an explicit emergency kill switch for new registrations.
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
- `/api/jobs/patient-file-gc`: staged/purge cleanup and expired-file retention;
  activate its schedule only after reviewing the configured retention policy.

Application job scheduling is an operator configuration, separate from the
deployment timer. The VPS cron/systemd inventory on 2026-11-05 did not contain
these application jobs. Do not infer scheduling from an installed route. Verify
outbound recipients/provider policy before enabling notification/recall delivery,
and retention/restore policy before activating file deletion.

Failed notification webhooks become `FAILED` rows and should be retried/triaged from Dashboard.

Notification workers atomically claim due rows as `PROCESSING` before delivery.
Apply the additive `20261021160000_notification_delivery_claim` migration before
starting this application version. Both batch and immediate delivery reject rows
already claimed or in a terminal state. The stable `Idempotency-Key` sent to Resend
and webhook receivers is `notification/<id>`; webhook receivers must persistently
deduplicate that key. Resend retains keys for 24 hours. Do not automatically replay
old ambiguous deliveries after that window.

A worker crash can leave a row in `PROCESSING` (use `updatedAt` to identify stale
claims). Do not reset these rows on a timer: first reconcile the notification ID
with the provider, then mark confirmed deliveries `SENT` or schedule a confirmed
undelivered notification for retry through an audited maintenance operation.
Credential notifications (`PASSWORD_RESET` and `STAFF_PASSWORD_SETUP`) contain
redacted bodies at rest and are excluded from the batch worker. Request a fresh
reset/setup link instead of retrying the persisted placeholder body.

Emails in `SUPER_ADMIN_EMAILS` are reserved and cannot be registered through public
trial signup. Provision platform operators through a trusted administrative path.
Demo and trial sessions never receive platform access, even for an allowlisted
email. Check identity ownership before converting an existing allowlisted trial
account to a non-trial workspace.

Demo cleanup requires `DEMO_WORKSPACE_ENABLED=true`, a strong `JOB_SECRET`, and a scheduled `POST` request. Send an empty JSON body with `Content-Type: application/json` on Namecheap/LiteSpeed so the request is not rejected before it reaches Next.js. Demo organizations are marked by `Organization.isDemo`; never purge organizations by slug/name pattern.

Hosted trial organizations are normal tenant workspaces with `Organization.trialEndsAt` set 30 days after registration; they are not marked `isDemo` and must never be removed by the demo cleanup job. Authentication rejects an expired trial until an operator or future billing flow converts it by clearing/updating `trialEndsAt`.

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

## payOS operator setup

Use **Settings → Tích hợp & AI → payOS** on the shared application host.
Choose the organization or an authorized clinic, enter Client ID, API Key and
Checksum Key from the operator's payOS channel, save, then verify. Verification
registers the callback with payOS and requires its authenticated sample to arrive
during the owner-initiated handshake; a successful API response alone is not
readiness. The displayed confirmed address includes its registered probe nonce.
The exact signed sample may be acknowledged again on that confirmed address;
it never records money. Ordinary orders still require trusted internal mapping.

Use **Billing → Hóa đơn → Thanh toán payOS** for QR/link creation, durable request
history and status refresh. Only a verified webhook records a receipt; returning
from checkout never marks an invoice paid. A verified transfer arriving after
invoice void becomes patient credit. Existing paid invoices cannot receive more
allocation than their remaining balance.
Invoice requests use a short transfer memo of at most nine characters to support
unlinked bank accounts; the complete order code remains the payment identity.
See the official [payOS payment-link contract](https://payos.vn/docs/api/).

Credentials are stored only as AES-256-GCM envelopes in `IntegrationCredential`.
Back up the database and the selected master together: optional
`INTEGRATION_SECRET_KEY` must be canonical base64 encoding exactly 32 random bytes;
otherwise `AUTH_SECRET` supplies the HKDF master. Changing the master without
resealing existing envelopes makes them unreadable. Do not rotate that key as a
normal credential edit; retain it for restore and plan a separate re-encryption
operation. Keys never appear in workspace DTOs, connection metadata or audit.

Unresolved requests block merchant-key replacement and disabling. A timeout or
ambiguous provider error remains unresolved even if a later retry is rejected.
Reconcile these requests against the original payOS channel before changing its
keys; do not edit payment metadata manually or claim that the absence of a local
receipt proves no payment exists. Enabling the same connection remains possible.
Use **Kiểm tra với payOS** on an unresolved request to query its original merchant.
The app validates the signed response and complete order identity. Confirmed
cancelled/expired requests with zero paid amount stop displaying their QR and
release the credential lock. A reported paid/partial amount hides the old QR and
shows that reconciliation is pending; the status query never creates a receipt.
Server-side reservation also rejects fresh intents and replays while that money
awaits a canonical receipt, even after selecting another merchant connection.
This guard is scoped to the same patient/invoice; other invoices remain usable.
Timeouts, missing orders, invalid signatures and paid cancellations leave the
request unresolved. A calendar expiry alone is not cancellation proof. Already
settled/retired history is not queried using replacement merchant credentials.
This action does not cancel a link, issue a refund or record money. Continue to
resolve disputed/partial payments against the original channel and canonical
receipt workflow; do not force a metadata edit.
The generic connections API rejects payOS writes; use the dedicated settings flow.
Legacy `env:PAYOS_DEFAULT` additionally requires `PAYOS_DEFAULT_ORGANIZATION_ID`
to bind those environment credentials to exactly one organization. Other tenants
must use their own stored merchant keys. Leave real payment activation pending
until the owner supplies and verifies their actual credentials.

## Documenso operator setup

Use **Settings → Tích hợp & AI → Documenso** to save the clinic's API Token and
Webhook Secret in the same tenant-bound credential vault. In Documenso, register
the displayed result URL with that secret and enable document-completion events.
Saved credentials do not verify either service availability or webhook delivery;
the panel separately reports whether a valid notification was observed. Legacy
environment credentials require `DOCUMENSO_DEFAULT_ORGANIZATION_ID`.
The supported contract is Documenso API v2 with `payload.envelopeId`,
`DOCUMENT_COMPLETED` and `X-Documenso-Secret`; follow the official
[webhook setup](https://docs.documenso.com/docs/developers/webhooks/setup) and
[event reference](https://docs.documenso.com/docs/developers/webhooks/events).

In **Biểu mẫu & đồng thuận → Ký qua Documenso**, choose an existing protected PDF
from the same patient's record and attach it to the open consent. Upload missing
PDFs through Journey. Review the source, recipient and email before sending.
Refresh/resume continues the reserved ceremony; it must not create a replacement
or redistribute after a lost response. A recipient correction after reservation
requires reconciliation of the old ceremony rather than sending its old envelope
under the newly displayed email. A creation timeout without an envelope ID stays
blocked for trusted callback recovery; do not clear metadata to force another send.

Active/uncertain ceremonies block changing keys, source PDF, manual completion
and voiding. Definitive initial rejection permits credential repair and manual
completion/void. The signed result is imported through protected file staging;
invalid PDFs and failed imports stay retryable without completing consent.
Only reconciled provider results display as electronically signed. Manual
completion and its supporting documents retain their own labels. Configure and
accept the real Documenso account separately before sending real patient data.

## Orthanc credential scope

Before enabling PACS, set `ORTHANC_DEFAULT_ORGANIZATION_ID` to the exact owning
organization ID alongside the `ORTHANC_DEFAULT_*` connection settings. The default
PACS credentials serve only that organization in hosted and self-hosted deployments.
Missing or mismatched bindings reject connection setup and block provider access
through existing import/viewer connections. Request fields cannot select the owner.
This binding does not activate PACS or replace private viewer authorization; keep
both services disabled until separately configured and accepted.
On upgrades of configured self-hosted installations, audit existing connections
and study/patient mappings for incorrect organization ownership before activation.
Do not automatically delete cached clinical metadata; reconcile any mismatches
through an operator-reviewed correction.

## Go-Live Gate

### Private local inference

`scripts/local-ai-services.py bootstrap` downloads the explicitly selected
Qwen3 4B model through a temporary, resource-bounded container with outbound
networking and no core database or patient mounts. The image is Ollama 0.40.15;
both image and model resolve to immutable digests in root-private
`/opt/codexdentist-local-ai/model-lock.json`. Subsequent bootstrap refuses to
replace an existing pin. Review model changes explicitly; retain the previous pin
and cache until the replacement is accepted. The accepted model uses
[Apache 2.0](https://ollama.com/library/qwen3:4b).

`local-ai-services.py up` starts only that service; `status` checks its model pin,
read-only model mount and root filesystem, local-only configuration and internal
network. The runtime publishes no ports and has no external network. It allows
one generation at a time, a queue of two, at most three CPU cores and 5 GiB RAM;
the owned VPS has four cores. Model keep-alive is two minutes. Back up the model
pin and immutable cache separately; neither is part of the four-service cold
snapshot. Never include prompt logs in model backups. Application AI run auditing
remains in the existing protected core database.

Join the core to external Docker network `codexdentist-local-ai_private`, then
select `CODEXMED_AI_PROVIDER=ollama`, `CODEXMED_AI_BASE_URL=http://codexdentist-ollama:11434`,
`CODEXMED_AI_MODEL=qwen3:4b` and `CODEXMED_AI_ENABLED=true`. No API key is needed;
the adapter never forwards an old cloud key. Only the owned private origin or an
explicit loopback origin is supported; cloud model names are rejected. Requests
do not follow redirects, cap context/response sizes and have a 90-second budget.
[Ollama cloud features](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features)
are disabled explicitly in addition to network isolation.

For an upgrade, deploy the compatible application with its old AI configuration
first, then perform the local-only environment cutover after verifying that exact
revision. Save the previous environment privately and hold the deployment lock.
If cutover checks fail, restore only that environment and recreate the same new
compatible image. Do not roll an old image into an unsupported `ollama`
configuration or silently fall back to a paid/cloud API. Verify private inference,
readiness, owner UI, core health under inference load and unchanged ledgers before
claiming the switch. Keep mail/storage configuration and existing vault keys intact.

Owned production cutover is complete for `2face1e`: its main push CI is
`42617070713`, core backup is `20261109T124204Z-2face1eaf30c`, and the root-private
environment rollback snapshot is under
`/opt/codexdentist-deploy/local-ai-activation-20261109`. The model cache snapshot
`/opt/codexdentist-local-ai/backups/20261109T121524Z-bcfd9e53` passed isolated
restore, all-file SHA-256 comparison and pinned-model opening. Independent runtime
inference returned the correct synthetic count in 53.4 seconds, with no cloud
fallback or database writes. Owner Settings displays Ollama/Qwen3 4B ready at
1440/390/320px; all four optional providers still verify. Health/readiness/go-live
and the before/after zero-mismatch financial audit pass. The generated review
session was revoked. Do not repeat the cutover over its retained rollback state.

### Free optional services

`scripts/optional-services.py` prepares root-private configuration under
`/opt/codexdentist-optional`, resolves upstream images to immutable digests and
starts only explicitly selected profiles. On first preparation pass the actual
owner's email with `--owner-email`; this creates no cloud account and sends no
email. Available profiles are `imaging`, `chatwoot`, `novu`, `medplum`. Services
have separate persistent volumes and private database networks. Administrative
HTTP ports 23801–23805 bind only to host loopback. No DICOM port is exposed.

The accepted versions are Orthanc 26.11.0, Chatwoot 4.19.1 CE, Medplum 5.2.14 and
Novu 3.19.0. Community features used here require no paid API or enterprise key;
Chatwoot's enterprise directory is excluded. Novu uses Valkey and MongoDB;
MongoDB is SSPL source-available, not an OSI license. Review upstream licenses
when redistributing. These services use the already-owned VPS; this is not a
claim that hosting, banking or an existing cloud account has no cost.

Build OHIF with `python3 scripts/build-private-ohif.py`, then select its local
image through `optional-services.py up --profiles imaging --ohif-image
codexdentist-ohif:e4cd861-responsive1`. The build verifies the exact official
commit, applies bounded responsive changes and uses a separate 4-GiB/two-CPU
builder. It retains upstream notices, builds the app subpath and records the
local immutable image ID. Keep the source revision/build script with backups.
Set `OPTIONAL_OHIF_BASE_URL` only to that private static subpath, and approve
each exact provider origin through `OPTIONAL_PROVIDER_ALLOWED_ORIGINS` before
saving/verifying the tenant-owned connection. Core app containers must join the
optional gateway network; databases remain on their separate internal networks.
Do not publish PACS, MongoDB, PostgreSQL, Valkey or OHIF directly.

Use `optional-chatwoot-bootstrap.rb` through the owned Rails runner after
`db:chatwoot_prepare`. Its private mounts create an owned confirmed administrator,
a dedicated API inbox with greetings/automations disabled, and a separate QA
account. Separate ordinary service agents belong to exactly one account/inbox;
their API tokens, rather than the installation administrator's token, enter the
app vault. It writes credentials only to root-private output files. The Chatwoot
staff link needs the owned HTTPS Chatwoot route and its own authenticated account;
never publish an uninitialized installation. `optional-services-acceptance.py`
creates separate project-bound Medplum credentials and a marked synthetic Novu
in-app subscriber/workflow. Its explicitly requested empty-bootstrap repair
refuses any existing patients, encounters, observations or client applications;
it rotates upstream defaults through the supported API without a database reset.
Bootstrap/acceptance response files contain secrets and stay root-private.
For the existing Traefik host, `up --profiles chatwoot
--chatwoot-proxy-network coolify --publish-chatwoot` first verifies the initialized
owned account and closed installation onboarding, then publishes only Chatwoot
through its own generated HTTPS routing file. It preserves Coolify's existing
routing files and publishes no other optional service. The corresponding
`--unpublish-chatwoot` removes only this exact generated file.
The separate Chatwoot login uses its generated administrator password in the
root-private `secrets.json`; do not put that password or service API tokens in chat,
issues or screenshots. Provision separate staff accounts before giving staff
direct access to the external Chatwoot workspace.
Use the private gateway URL for Chatwoot API calls and the separate approved
`publicBaseUrl` for staff browser links; service credentials never need to traverse
the public edge proxy. Both configured origins must be operator-approved.

Production release `87f06bd` has all four organization-owned connections enabled
for `phuongthao`. Core joins `codexdentist-optional_gateway`; private origins and
`OPTIONAL_OHIF_BASE_URL` are approved explicitly. The latest optional snapshot
`20261109T111052Z-123500b2` passed isolated restoration of both PostgreSQL stores,
MongoDB counts and authenticated PACS startup. Core release backup is
`/opt/codexdentist-deploy/backups/20261109T111235Z-87f06bd716e6`.

For reviewed maintenance commands, use `scripts/run-owned-app-command.py` with
the exact running revision, a root-owned source directory and an explicit command.
It pins the running image/network namespace and forwards the resolved container
environment through a private pipe. Do not pass Compose source dotenv files to
`docker run --env-file`: Docker preserves literal quotes that Compose removes.
This difference can seal new vault credentials under the wrong key while still
passing an isolated provider probe. Never rotate the shared authentication/vault
master to repair such an activation. Verify actual app reads after configuration,
not only connection metadata. The November activation repaired only its four new,
unconsumed configurations after proving the original credentials and the exact
quote-only discrepancy; existing credentials and the shared key were preserved.

Cold snapshots: run `optional-services-backup.py backup --profiles imaging
medplum chatwoot novu`. This briefly stops only the selected optional services,
records provider counts, snapshots their cold volumes and private configuration,
and restarts them even after backup failure. It never stops the core clinic app.
Run `optional-services-backup.py drill --snapshot <completed-directory>` before
activation. Checksums and safe archive extraction precede restoration into new
randomly named volumes; only databases/PACS start on internal networks, without
host ports or message workers. Compare record counts and authenticated PACS
startup, then remove only those generated restore containers/volumes. Back up
the core database and its unchanged vault master separately using the existing
reviewed deployer. A cloud mail/file/AI migration requires its own verified
cutover; do not delete existing R2 objects or disable credential email delivery.

The integrated roadmap release in PR #68 adds six migrations, including composite
tenant/clinic constraints. Review the exact migration range and run a production
backup through isolated restore/migrate before cutover. The unattended Hostinger
CREATE-only policy must continue to reject this constraint batch until reviewed;
do not delete a deployment marker or change migration checksums to force a retry.
For an explicitly reviewed manual batch, pass `--reviewed-migrations <path>` to
the installed deployer. The root-owned, non-writable-to-others JSON records
`sha`, `previous`, and `migrations` (each changed migration path mapped to its
SHA-256). It must match the entire exact release range and SQL bytes; modified
existing migrations remain forbidden. The timer does not pass this option.
All CI eligibility, backup/isolated restore, candidate and rollback checks still
apply. Review and install deployer changes explicitly outside the release checkout.
Optional payOS, Documenso and Orthanc/OHIF stay disabled without real configuration.
Private OHIF/PACS access must enforce study authorization independently of knowing
a viewer URL; desktop/mobile integration evidence must be collected before enabling it.
Production notification readiness accepts configured Resend email or validated
HTTPS webhook delivery. Unsupported channels must never be reported as sent.

Run before connecting real patient data:

```powershell
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run build
npm run test:smoke
npm run test:roles
npm run test:actions
npm run test:tenant
npm run test:hardening
npm run test:security
npm run test:billing
npm run test:billing-concurrency
npm run test:patient-files
npm run test:data-integrity
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
- active users still accepting test/demo passwords.

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

The additive `20261022000000_global_document_sequence` migration creates only the
FRM/RX global counter table. Apply migrations before deploying the application. Existing
printable identifiers and unique indexes remain intact; first allocation starts above
the maximum existing suffix for its type/year. Gaps are allowed after failed writes.
Organization provisioning now rolls back the entire owner/clinic/default setup on failure
(transaction timeout 60 seconds). Workspace reads no longer recreate or refresh defaults.
No operational reseed is required for this release.
Application failures log an incident UUID, area and an allowlisted database code, without
raw messages, stack traces or patient payloads. Use timestamp/area/incident to investigate.

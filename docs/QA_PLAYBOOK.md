# Codexdentist QA Playbook

Last updated: 2026-11-10
Status: ACTIVE

Scheduling concurrency acceptance runs `NODE_ENV=test npm run test:audit-db`
against an explicit disposable loopback PostgreSQL database. Four uniquely owned
synthetic workspaces execute together. Each holds a real provider advisory lock,
observes an actual waiting database session and proves no appointment commits
before release; after release one booking wins and its cross-clinic competitor
returns a domain conflict. Cover shared provider/chair races, adjacent slots,
tenant denials and notification claims. Await all pending commands before fixture
cleanup, including when the wait assertion fails; never delete another workspace.

This playbook implements the closed-loop quality process defined in `docs/PROJECT_CONTEXT.md`:

```text
baseline -> implement -> audit -> classify -> fix -> re-audit -> repeat -> phase exit
```

A passing build alone is not enough. Every changed high-risk boundary must pass its focused negative/regression tests before a phase can close.

Owned email changes require `npm run test:owned-mail`, `python3
scripts/owned-mail-services.test.py`, `NODE_ENV=test npm run test:owned-mail-db`
and `NODE_ENV=test npm run browser:owned-mail`, with explicit loopback disposable
PostgreSQL. The unit/HTTP gates use actual TLS SMTP with an isolated local
certificate, signed requests and encrypted SQLite, not a cloud inbox. Cover
header injection, foreign receipts, concurrent workers, credential redaction,
lost SMTP acknowledgements without replay, corrupted payloads, expiry and
networkless restoration of the idempotency state. Test-only SMTP must never
pass a production readiness check. Re-run the same tests on the built Node 22
Linux image; the fixture's recipients are restricted to `.test`/`.invalid`.
Full-app acceptance requests a reset, consumes the actual captured one-time
link, signs in again and inspects settings at 1440/390/320. No real user,
patient message or external destination enters this test. DNS and actual MTA
queue/delivery/backup acceptance are separate production gates. Run `sudo -n
python3 scripts/owned-mail-linux.py --image codexdentist:ci --source "$PWD"
--output /tmp/codexdentist-mail-proof` for pinned real Maddy with no external network.
It checks actual DKIM cryptography/tampering, sender restrictions and idempotency,
then cold-snapshots both disposable volumes and restores them without workers.
Verify private modes, every checksum, SQLite integrity and the encryption-key
probe; corrupted archives/keys must fail before recovery. Backup-failure tests
must prove all previously active services get a restart attempt. These private
test outputs contain synthetic keys and must not be uploaded as public artifacts.
They must remain outside the source/build tree (CI uses `RUNNER_TEMP`); the
operator rejects an in-tree destination. Never broaden their private permissions
to let a build tool scan them.
App transport cutovers additionally run `python3 scripts/owned-mail-app-cutover.test.py`:
verify both existing YAML sequence styles, quote-preserving dotenv updates,
complete resolved/runtime deltas, exact-image/private-volume preservation,
read-only public CA forwarding and rollback that refuses concurrent edits. A
successful SMTP submission is insufficient: for a specifically approved external
test compare the actual inbox Message-ID/nonce and SPF/DKIM/DMARC result. Do not
repeat a consumed one-message approval or send real credential/patient mail for
QA. After configuration change, run independent go-live/readiness and compare the
financial baseline; inspect actual owner mail Settings at 1440/390/320 without
submitting another email. Password reset/consume/signin remains covered by the
disposable full-app actual TLS gate, not by changing a real owner's password.

Owned signing runtime changes require `python3 scripts/owned-signing-services.test.py`
and the actual Linux gate `sudo -n python3 scripts/owned-signing-linux.py --source
"$PWD" --output "$RUNNER_TEMP/codexdentist-owned-signing"`. Use a fresh private
output outside the source/build tree; never upload its keys/captured mail as CI
artifacts. The gate creates only unique labelled private services, verifies
database/certificate health and the actual disabled signup API, then restarts
the app/cache after private AOF files exist. Assert authenticated Valkey PING;
`Running=true` during a restart loop is failure. Cold restoration checks every
byte, UID/GID/mode, PostgreSQL table count, certificate passphrase and cache AOF
load/authentication; repeated drills must pass. Restored app/mail/BullMQ workers
never start. Corrupted key/archive copies must fail before a restore starts.
Keep the standalone provider ceremony and core consent/webhook/replay gates:
private runtime readiness is not operational signing acceptance.
Gateway changes additionally run `python3 scripts/owned-signing-gateway.test.py`.
The Linux signing gate takes `--image codexdentist:ci`, starts a fresh uniquely
named private proxy and checks real TLS, both scoped API tokens, invalid tokens,
administrative/auth/bulk API denials and batched procedure smuggling. Its combined
snapshot must restore the exact gateway TLS pair/configuration as UID 101 with
`nginx -t` and no restored workers, then pass authenticated encrypted recovery.
Use real synthetic PDF ceremony QA for route changes: wait for the rendered
canvas and final exact "Everyone has signed" status, not a substring in text
about future completion. Inspect final desktop/phone screenshots and verify the
downloaded CMS/tamper denial. Private loopback-origin QA is separate evidence
from eventual public-hostname and core consent/webhook acceptance. New envelopes
must explicitly carry Vietnam timezone and day/month/24-hour presentation; old
reserved ceremonies retain their original source/recipient identity.
Recipient publication additionally runs `python3 scripts/owned-signing-recipient.test.py`.
The native gate creates a distinct recipient process on a unique internal edge,
without reaching the shared production proxy. Verify only its HTTP configuration
is mounted, administrative/API routes fail and port 3443 refuses connections.
Combined recovery includes all four recipient files and networkless Nginx syntax
acceptance; incomplete sets or missing restoration proof must fail authenticated
off-server verification. Publication rollback tests cover public probe/runtime
failure and concurrent foreign route changes. Public HTTPS ceremony acceptance
remains separate from this isolated edge gate.
Cold phone loads must finish all application chunks without 502/reset failures;
serial health alone missed the initial 256-connection bottleneck. Native acceptance
now checks 220 simultaneous static requests through both proxy hops, exact 1024
worker/4096-descriptor capacity, and rollback of both configuration sets on failure.
Callback changes additionally run `python3 scripts/owned-signing-callback.test.py`
and `sudo -n python3 scripts/owned-signing-callback-linux.py --source "$PWD/scripts"
--output "$RUNNER_TEMP/codexdentist-signing-callback" --image codexdentist:ci`.
The isolated fixture proves real Nginx TLS, CA rejection, POST-only path routing,
preserved secret headers and complete cleanup. It does not prove core webhook
authorization/reconciliation. The full CE Linux gate also enables callback trust
with a pre-change restored snapshot, verifies actual provider TLS/unknown-CA
denial, then cold-restores callback keys/configuration and app-readable public
trust without starting restored workers. Unit regressions cover rollback and
foreign concurrent edits; encrypted recovery rejects partial callback identities
or missing callback restore proof. Full application signing remains a separate gate.
Run `node --test scripts/owned-signing-webhook-client.test.cjs` for principal,
connection-path and secret rejection. Native CE acceptance must create and inspect
separate main/QA completion webhooks through the actual authenticated APIs, preserve
their intent/acknowledgements with recovery, and perform no synthetic event delivery
to a production core. Actual core authorization, reconciliation and replay require
the later full-app fixture, not the small transport receiver.
Bootstrap changes also run `python3 scripts/owned-signing-bootstrap.test.py`,
`node --test scripts/owned-signing-bootstrap-client.test.cjs` and
`python3 scripts/owned-signing-seal.test.py`. Native CE acceptance must create
and verify separate main/QA identities, exercise actual CSRF/signin/token APIs,
reject a valid token substituted across their stored identities, close signup
and restore account credentials alongside the provider database. Consume the
pinned CE's actual `/verify-email/<token>` link. Backend capture reads send no
app Origin/cookies/credentials; do not loosen Mailpit CORS to mask a protocol bug.
Crypto verification must wait for authenticated decryption to finish before
publishing proof, reject a modified authentication tag even when an outer
checksum is replaced, and reject unauthenticated CMS/CBC. Native CI seals and
verifies actual snapshot bytes with a synthetic recipient key kept only in its
isolated private fixture. Real off-server verification uses the existing owner
key only on the owned recovery computer and never writes decrypted archives.

Mail activation regressions must deny duplicate SPF, a foreign persistent DKIM
key, wrong forward/reverse identity, edited configuration, failed backup and
nonempty initial queues. Startup/readiness failure must restore both original
files and restart the original stage. Assert that only SMTP gains egress and
that this transition neither sends mail nor changes core transport settings.

Durable storage changes require `test:durable-files`, `python3
scripts/durable-files-ops.test.py`, `NODE_ENV=test npm run test:durable-files-db`
and `NODE_ENV=test npm run browser:durable-files` with explicit disposable
loopback PostgreSQL. After building the Linux image, run `python3
scripts/durable-files-linux.py --image codexdentist:ci --source "$PWD" --output
output/durable-linux`. It creates only uniquely labelled, network-isolated test
containers/volumes, exercises actual non-root mounted reads, stream cancellation,
root/read-only/unmounted denials, S3-to-local CLI retries and checksum failures,
then restores the snapshot into another networkless volume. The database gate
checks one concurrent winner, stale/foreign rejection, unchanged clinical metadata
and retention targeting the relocated stage. Inspect synthetic upload evidence
at 1440/390/320px. An unauthenticated file request must redirect to `/login` without
returning bytes; foreign-tenant requests remain 404. Production acceptance must
verify the existing file's checksum through its protected route and prove a fresh
database-plus-file restore, not only a successful empty-volume probe.

Local inference changes require `npm run test:local-ai` and
`python3 scripts/local-ai-services.test.py`. Use `NODE_ENV=test npm run
browser:local-ai` with explicit disposable loopback PostgreSQL and an owned
preloaded Ollama server tunneled to `LOCAL_AI_QA_BASE_URL` (default
`http://127.0.0.1:24806`). It creates/migrates/drops only its unique test database,
exercises actual Next actions and the provider, verifies grounded numbers rather
than merely valid JSON, and captures pending/success/unavailable states at
1440/390/320px. No operational records or cloud credentials enter the test.
Dashboard AI counts must match complete visible-clinic aggregates; array metadata
and capped previews cannot become appointment counts. Input echoes and malformed
module/accounting answers cannot be recorded as successful runs. Review generated
Vietnamese content as well as schema, resource use and screenshots before cutover.

Client-only signing triggers remain disabled in server HTML until their click
handlers mount. The consent browser gate must observe the successful workspace
GET for the exact newly selected form before asserting its rejection state;
visible server markup or a previous form's dialog is insufficient readiness.

Optional-service changes require `npm run test:optional`, `NODE_ENV=test npm run
test:optional-db` with explicit loopback `DATABASE_URL` and
`CHATWOOT_TEST_DATABASE_URL`, and `NODE_ENV=test npm run browser:optional`.
The browser runner creates/migrates/drops only a uniquely named disposable
database and starts its own Next development server on port 3002. It exercises
actual bank settings/vault/QR routes, unchanged receipt/payment ledgers, patient
tools and auth/CSRF, in addition to isolated panel state/race tests.
`python3 scripts/optional-services.test.py` enforces opt-in profiles, private
database networks, loopback-only ports, resource bounds and credential files.
It also tests lossless forwarding of the running app environment for maintenance
commands, including literal quotes, dollar signs, empty values and rejected
multiline injection. The runner was exercised against all four live providers.
After production activation, an enabled badge alone is insufficient: exercise
an authenticated consumer that decrypts the vault using the app's actual runtime
key, verify the Novu operator GET and marked synthetic delivery through `SENT`,
and inspect error alerts as well as console errors at 1440/390/320px. Revoke only
the short-lived review session afterward; never replace existing owner sessions.

Real provider acceptance uses only QA-specific accounts/projects projected into
a private ignored file, with an owned SSH loopback tunnel. Run
`NODE_ENV=test node scripts/optional-provider-live-acceptance.cjs` and the app
runner with `--live-providers`. No mock-only result substitutes for this gate.
Cover actual OAuth/conditional FHIR creation and stale-version rejection,
Chatwoot opaque contact/conversation recovery without message POST, Novu in-app
worker delivery, authenticated PACS/DICOMweb and OHIF pixels. The app runner
also checks foreign-tenant viewer/frame/export denials and removes only its own
synthetic PACS study. Inspect fresh 1440/390/320px evidence under
`output/workspace-qa/optional-app`; restore drills use entirely separate volumes
and start no API, mail or notification worker from restored records.

Shared sign-in changes require `test:audit`, `test:tenant` and `browser:trial-signup`: verify root-host login/session, patient isolation between two organizations on the same host, ignored client-supplied organization scope, host-only cookies, shared recovery/setup links, legacy deep-link redirects, signup, re-login and expired-trial rejection. The trial browser maps the shared hostname to disposable loopback and captures desktop/mobile login and dashboard evidence under `output/workspace-qa/shared-login`.

For clinic permissions, signup/recovery, scheduling, notification delivery, or mobile
dependency changes, run `npm run test:audit` and `npm audit --audit-level=high`.
Run `NODE_ENV=test npm run test:audit-db` against a disposable PostgreSQL database on
loopback after applying migrations. This invokes the actual scheduling and delivery
functions, races provider/chair bookings and batch/immediate notification workers,
and verifies credential emails cannot be sent from redacted persisted bodies.
The database tests create and clean up only their own randomly identified workspace.
CI runs both suites; a mock-only race test is insufficient for these database boundaries.

Run `NODE_ENV=test npm run test:seed-ledger-db` on disposable loopback PostgreSQL
after seed changes. Synthetic paid invoices must have matching payments, receipt
totals and allocations; repeat seed bookkeeping must be idempotent and refuse
non-fixture payment history. `prisma/seed.js` refuses production, missing explicit
database configuration and remote database hosts. Never run it to repair live
opening balances: historical fixtures require a separate provenance review.

Revenue changes also run `test:financial-ledger-db`. The runner creates a uniquely
named loopback database, applies the full migration history, exercises actual
Revenue commands and removes only that generated database. Cover paid void/replay,
two intentional partial refunds, same-intent and shared-receipt races, commission
generation racing refund, first generation after a refund, fixed fees, unsafe
adjustment denials and tenant/clinic permissions. `test:billing` also reconciles
invoice paid amounts to signed payment totals. `browser:qa` includes the refund
form, exact Server Action replay, a new intentional refund after refresh, and the
visible refunded-void denial at 1440/390/320px. No provider or real money is used.
The financial database runner also holds each transaction before its first read
to prove both void/generation commit orders. Commission basis snapshots are
atomic evidence; transaction start or receipt-update times are not substitutes.

Deployment principal changes require `python3 scripts/deploy-hostinger.test.py`
and `NODE_ENV=test npm run test:migration-role-db`. The PostgreSQL regression
reproduces REFERENCES denial under a limited runtime role, checks the empty
partial artifact, completes the exact canonical FK suffix as migration admin,
and proves new owner-created tables keep runtime CRUD without granting core
REFERENCES or elevated roles. The restore drill must verify both migrated schema
and limited runtime access; data restored with `--no-owner --no-acl` alone cannot
verify production permission parity.

After demo lifecycle or organization-purge changes, run `NODE_ENV=test npm run
test:demo-cleanup-db` against disposable loopback PostgreSQL. It creates an expired
demo with an invoice, invoice item, receipt and linked allocation, exercises the
real purge SQL under billing constraints, and proves an unrelated tenant survives.

## 1. Universal Baseline Gate

FHIR changes run `test:phase6`: assert unstructured names retain their text across
Vietnamese, multipart international and single-token examples without guessed
family/given fields. The real export command/route regressions also check disabled,
unauthenticated, denied-role, tenant/clinic/missing-record and failed-audit responses,
FHIR media type/no-store and the PHI-minimized export audit. The source-loader
replaces database/session I/O only; permission, scope and mapping code stay real.

Run before and after every non-trivial phase/change:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run test:security
npm run test:tenant
```

For changes that can affect bundling, routes, server/client boundaries, runtime imports, or public artifacts, also run:

```bash
npm run build
npm run test:smoke
```

For visible workflow/layout changes, also run:

```bash
npm run browser:qa
```

Journey selection changes require the actual composer regression and real-browser
navigation checks: valid patient -> unknown/out-of-scope/cleared URL hides editable
content immediately, including stale topbar and AI identity; Back restores the
same comments, attachments and temporary treatment targets. A hidden record must
pause native media and leave no open native modal or inert background. Actual
patient lookup navigation, Back/Forward and reload must
open the intended record. A different patient must not inherit a comment, file
selection, treatment draft or pending dialog. Exercise desktop/mobile states and
inspect fresh captures. Native history transitions test the mismatch guard;
positive navigation must also fetch the server-scoped workspace normally.

Do not suppress a failing safety test to complete a phase. Classify the failure, fix it, and repeat the relevant gate.

### Public landing page

Run `npm run browser:landing` against a disposable local production build after landing changes.
The gate captures eight viewport profiles (320-1920px, including landscape), all three
story states, mobile navigation and FAQ states. It checks keyboard navigation,
contrast, overflow, resource errors, links and no-JavaScript progressive enhancement.
Screenshots and a commit-bound report are uploaded by CI as `landing-qa-<sha>`.
Review the actual screenshots before merging; automated checks are not a visual sign-off.
The shared demo/docs/features styling and root hostname routing must stay intact.

## 2. Finding Severity

- **Blocker**: cross-tenant access, authorization bypass, PHI exposure, data loss/corruption, billing reconciliation/concurrency failure, destructive migration without safe restore, provider bypass of canonical application boundary, or broken production boot for the changed path.
- **High**: violated documented domain invariant, missing idempotency on externally retried mutations, protected-file lifecycle failure, incorrect clinical history/revision behavior, or architecture dependency that allows core business rules to be bypassed.
- **Medium**: maintainability/design defect that violates the target architecture or creates likely future duplication but does not currently expose/corrupt data.
- **Advisory**: improvement that does not violate the current phase exit criteria.

Phase exit requires zero unresolved Blocker/High findings and no Medium finding that violates an explicit exit criterion.

## 3. Change-to-Gate Matrix

| Changed surface | Required focused gates |
| --- | --- |
| Documentation / architecture tooling only | `encoding:check`, `typecheck`, `agent:audit`; manually compare docs and checker rules for consistency. |
| Shared UI / CSS / shell | universal gate + `build`; add `browser:qa` for responsive/layout/interaction changes. |
| Route / Server Action / route handler | universal gate + `build` + `test:smoke`; add affected domain and browser gates. |
| Permission / auth / tenant scope | `test:roles`, `test:actions`, `test:tenant`, `test:security`, `test:security-runtime`, plus affected smoke tests. |
| Revenue / billing | `test:billing`, `test:billing-concurrency`, `test:data-integrity`, `test:tenant`, `test:security`. |
| Journey / clinical | `test:integration`, `test:tenant`, `test:security`, `test:data-integrity`, affected odontogram/manual checks, `browser:qa` when UI changes. |
| Patient files / storage | `test:patient-files`, `test:tenant`, `test:security`, `test:data-integrity`; add lifecycle/reconciliation tests for staged-file work. |
| Compensation / payroll | `test:compensation`, `test:source-commission`, `test:data-integrity`, `test:tenant`. |
| Prisma schema / migrations | universal gate + affected domain tests + migration review + backup/restore consideration; never use reset to make a migration pass. |
| Integration inbox/outbox/provider | universal gate + new provider/inbox/outbox idempotency tests + affected domain gates + `test:data-integrity`. |
| Deployment / self-host | `build`, `readiness:check`, self-host compose/build checks, and relevant health/restore checks from `OPERATIONS.md`. |

## 4. Architecture Audit Contract

`npm run agent:audit` must enforce the active target architecture without assuming that legacy code has already been migrated.

New architecture roots:

```text
src/shared
src/domains
src/features
src/infrastructure
src/integrations
src/workspaces
```

Required principles:

- `shared` remains business-agnostic.
- `domains` cannot depend on Next.js, Prisma, provider SDKs, app routes, workspaces, or concrete infrastructure.
- `features` cannot depend on app/workspace UI or concrete provider adapters.
- `infrastructure` does not depend on app/workspace UI and does not own product workflow policy.
- `integrations` cannot depend on app/workspace UI and cannot directly import Prisma/core DB implementations to mutate canonical domain records.
- `workspaces` cannot depend on app routes, Prisma/storage implementations, or concrete provider adapters.
- `app` is the allowed composition/transport layer.
- Existing `src/components`, `src/modules`, and broad `src/lib` remain migration territory. Do not add a route-specific migration exception or a legacy component name as the architecture target.

Architecture checks should become stricter as code is migrated, not by retroactively declaring all baseline legacy code invalid.

## 5. Phase 0 Gate — Context And Enforcement Reset

Required evidence:

- `PROJECT_CONTEXT.md` explicitly supersedes prior product/refactor contexts.
- `AGENTS.md`, this playbook, and the architecture checker agree on the same target layers.
- No active QA instruction requires the retired `/today`, `/work`, `/patients/[patientId]`, `/operations/finance` migration plan.
- Architecture tooling has no active `DentalSuite/AppViewPage` migration rule.
- `infrastructure` and `integrations` are recognized by architecture tooling.
- Obsolete deploy-target wording is removed when it can be mistaken for current direction.

Commands:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
```

If one fails, fix and rerun all three before Phase 0 closes.

## 6. Phase 1 Gate — Application Boundary

For each migrated use-case:

1. Verify the Server Action/route handler performs transport concerns only: parse, authenticate, dispatch, map response/revalidate/redirect.
2. Verify business rules live in one application command/use-case.
3. Verify authorization and tenant/clinic scope cannot be skipped by another transport.
4. Verify a job/webhook/API could invoke the same application command without importing UI code.
5. Search for duplicated old mutation logic and remove/delegate it once safe.

Revenue migration must pass:

```bash
npm run test:billing
npm run test:billing-concurrency
npm run test:data-integrity
npm run test:tenant
npm run test:security
```

Journey/file migration must pass:

```bash
npm run test:integration
npm run test:patient-files
npm run test:data-integrity
npm run test:tenant
npm run test:security
```

## 7. Phase 2 Gate — Integration Substrate And File Lifecycle

Add automated tests for at least:

- duplicate inbox event ID;
- same webhook replayed after success;
- processing failure followed by retry;
- outbox event committed with its required domain transaction;
- dispatcher/provider failure without rollback/corruption of committed core state;
- tenant mismatch on external reference;
- staged file created but DB commit fails;
- staged object reconciliation/garbage collection;
- committed protected file remains inaccessible across tenant/clinic boundary.

Run affected schema/data integrity and protected-file suites after every fix.

## 8. Phase 3 Gate — payOS / Documenso

### payOS

Run `test:payos` for merchant binding, encrypted envelope handling, permissions,
retry uncertainty, invoice revalidation and legacy-configuration refusal.
The same gate includes signed status recovery: full identity/signature checks,
unpaid terminal retirement, paid/partial refusal, tenant/clinic/patient/demo/CSRF
denials, concurrent SETTLED preservation, and late creation responses that cannot
restore a retired QR. Full app QA checks paid observations across reload without
fabricating a receipt, then confirms unpaid expiry alone permits key repair.
`NODE_ENV=test npm run test:payos-reconcile-db` creates and migrates a fresh
loopback database, then checks actual row locks, encrypted key replacement,
canonical settlement racing status recovery, late writes and reversed paid/zero
observation completion order. Its provider boundary is synthetic; signature
validation is exercised independently by handler and full-app tests.
The native gate also races two new intents after a paid observation, checks an
older organization merchant cannot be bypassed by a clinic merchant, preserves
unrelated invoices and permits new credit requests only after canonical settlement.
Full-app/production UI gates directly POST both a replay and a new key while money
awaits its receipt: both must return 409 without creating another request. Configure
the production QA server's `PAYOS_DEFAULT_BASE_URL=https://127.0.0.1:11444` (as CI
does) so a regressed guard cannot send synthetic keys to a real merchant endpoint.
`NODE_ENV=test npm run test:integration-vault-db` explicitly runs the native
loopback PostgreSQL gate: fresh migrations, tenant FK/AAD isolation, UTC,
rotation races, rollback and cascade. Unit-only runs may skip that native case;
never report the skip as native evidence.

`browser:payos-production` checks the built app with fresh owned synthetic
organizations: real credential save/no readback, pre-verified order fixtures,
QR/history/reload, permission denials, signed callback and receipt reconciliation
at 1440/390/320px. Set `PAYOS_QA_APP_URL=http://127.0.0.1:3000` and `NODE_ENV=test`.
It performs no outbound provider requests. `browser:payos` separately starts a
development app on 3001 and a loopback HTTP merchant on 11444, exercises actual
verification/link creation, lost-response retry and repeated signed callbacks.
Stop the production verification server first because Next shares its build
directory. Production provider HTTPS guards stay unchanged; no custom CA trust
or TLS override is required. Both gates require an explicit loopback database,
purge only their newly owned organizations, and save separate browser evidence.
The development gate allows 60 seconds for the initial authenticated navigation:
Next compiles the dashboard after login on a cold CI runner. Production browser
login keeps its 15-second limit; credential, redirect and final-page assertions
are unchanged.
Billing tab interactions wait for WorkspaceTabs' layout-effect tabindex before
clicking, then assert the selected tab. A cold development route can display its
server-rendered buttons before hydration attaches their event handlers; network
idle alone is not an interaction-readiness assertion.

The native queued-outbox heartbeat test observes both PostgreSQL lock timestamps
advance beyond their original expiry over multiple one-second leases before
starting a competitor. A 150-ms native lease had measured shared-runner scheduling
latency instead of renewal correctness. Tiny deterministic heartbeat failure,
stolen-owner and CAS tests remain intact. Reclaim/retry deadlines use PostgreSQL's
clock; clock-skew regressions cover app time both ahead and behind by one minute.

Verify:

- signature validation before processing;
- tenant/clinic mapping through trusted internal references;
- duplicate, delayed and reordered notifications;
- amount/currency/reference validation;
- verified late transfers after invoice void become patient credit without
  reviving the invoice; missing/wrong-scope invoices still reject;
- uncertain creation stays unresolved across later rejected retries; fresh
  definitive rejections allow correction, while pending orders block key changes;
- a fresh inbox event is ready according to the database clock; clock skew must
  not turn its first delivery into retry backoff;
- application Revenue command is the only path that records settlement;
- no provider adapter imports Prisma/core billing repository implementation directly;
- billing reconciliation and concurrency suites remain green.

`test:audit` includes real handler regressions for retryable webhook responses and
durable signed-file staging, plus authenticated payment-link response matching.
`test:phase3` also races two provider settlements against one invoice in disposable
PostgreSQL and reconciles invoice allocations, receipt totals and excess credit.
Never acknowledge an inbox backoff as successful processing. Commit the file stage
before object I/O so interruption cannot erase its discovery record.

### Documenso

Real-provider preflight must exercise the actual pinned community image, a
synthetic PDF, captured private SMTP, API create/distribute, browser signature/
completion and adapter download. Verify the PDF CMS signature against the exact
owned test certificate and reject tampered bytes. Keep the provider's network
internal; record core callback/import acceptance separately. Stop only the
generated QA services after inspection and retain their labelled data/proof.

Before activation, reject a foreign completed-envelope response before any PDF
download; enforce the JSON size bound on chunked responses as well as declared
lengths. A real loopback HTTP redirect must receive zero forwarded PDF requests,
and provider error details must not enter application exception messages.

Run `test:documenso` for real handler/command regressions and
`NODE_ENV=test npm run test:documenso-db` for a newly created/migrated loopback
database with credential/reservation, duplicate send and manual-action guards.
The production app gate `browser:documenso-production` creates fresh owned
fixtures, exercises settings/PDF attachment/manual-completion refusal and signed
states without making provider requests. Full `browser:documenso` separately
runs a development app on 3002 plus a loopback signing engine on 11445: actual
create, interrupted distribution, resume without duplicate delivery, reload,
invalid secret/PDF, import retry and duplicate completion. Verify exactly one
protected signed file, Journey event and completion audit. Both capture
1440/390/320px and clean only their newly owned organizations/files. The local
runner prepares the normal font assets before visual review.

Include recipient edits between creation and resume, manual-only completion,
definitive FAILED labels, key/source replacement and signed-file provenance in
independent review. Never use a manually completed form or an attached source
PDF as evidence that the provider signed it. Keep real-provider acceptance
separate from synthetic/browser fixtures.

Verify:

- only minimized necessary participant/document data leaves Codexdentist;
- webhook/event verification and inbox idempotency;
- retry-safe signed-document retrieval;
- signed PDF passes protected-file validation/lifecycle;
- consent status, file record, Journey event and audit record reconcile after failure/retry;
- disabled/unavailable provider does not break unrelated clinical workflows.

## 9. Phase 4 Gate — Orthanc / OHIF

Verify:

- tenant/clinic/patient-scoped imaging references;
- no DICOM blob storage in PostgreSQL;
- stable patient/study mapping rather than name/email heuristics;
- authorization before viewer/study access;
- cross-tenant and inaccessible-clinic negative tests;
- unavailable PACS behavior is safe and understandable;
- backup/restore ownership for imaging data is documented;
- supported desktop/mobile workflow has no critical overflow/navigation break.

## 10. Phase 5 Gate — Native Dental Operations

`operations-workspace-qa.mjs` runs under `browser:qa` on a disposable loopback
app/database. It creates a lab case through delivery, creates an instrument and
cycle through release, checks tenant/clinic membership and audit counts, and
captures 1440/390/320px states. Global operators explicitly choose an authorized
clinic for sterilization; server commands validate that scope independently.
Lifecycle tests also exercise a non-UTC PostgreSQL session: naive timestamps
and leases use UTC expressions without changing historical migration checksums.

For Lab/Sterilization or other native dental capabilities:

- use canonical Organization/Clinic/Patient/Staff references rather than creating parallel identities;
- permissions are server enforced;
- audit trail exists for clinically/operationally significant transitions;
- Journey gets a projection/event only where useful; Journey does not become owner of the entire module;
- inventory/material effects remain transactionally and tenant safe;
- no imported PMS becomes a second source of truth.

Run tenant, action permission, data-integrity, smoke, and browser gates plus feature-specific tests.

## 11. Phase 6 Gate — Optional Communication / FHIR

Verify:

- provider adapters can be disabled without breaking core workflows;
- notification provider abstraction works without leaking vendor objects into domains;
- Chatwoot mapping uses stable external references and does not overwrite canonical Patient/CRM identity;
- FHIR mappings are adapters; internal schema is not forced to mirror external resources;
- inbound updates are idempotent and authorized;
- PHI is minimized in logs/events;
- tenant isolation remains green.

## 12. Release Hardening Gate

Before real patient data or a production release after migration batches, run the full relevant regression suite, including at minimum:

```bash
npm run encoding:check
npm run typecheck
npm run agent:audit
npm run build
npm run test:smoke
npm run test:roles
npm run test:actions
npm run test:tenant
npm run test:security
npm run test:security-runtime
npm run test:hardening
npm run test:billing
npm run test:billing-concurrency
npm run test:patient-files
npm run test:data-integrity
npm run test:compensation
npm run test:source-commission
npm run browser:qa
npm run go-live:check
```

Also run the self-host packaging and restore drill in `docs/OPERATIONS.md` when migrations, storage, deployment, or infrastructure changed.

## 13. High-Risk Manual Regression Checks

Automated tests do not replace these targeted observations when the corresponding workflow changes:

- Journey opens the intended patient and preserves chronological clinical history.
- Odontogram FDI mapping, stage independence, revision conflict behavior, multi-selection, and treatment-target separation remain intact.
- Billing receipts, allocations, partial invoices, refunds and unallocated credit reconcile after refresh and concurrent operations.
- Protected patient files cannot be fetched by another organization, inaccessible clinic, or unrelated patient portal account.
- Staff/role administration cannot demote/disable protected equal-or-higher authority incorrectly and preserves at least one active owner.
- Patient portal shows only the linked patient's data and future actionable appointments.
- Vietnamese operational copy renders without mojibake and critical layouts do not horizontally overflow at supported mobile widths.

## 14. Audit Loop Record

Do not create a permanent session log. For each phase/PR, the PR description or commit evidence should state succinctly:

- baseline gates run;
- implementation scope;
- findings discovered;
- fixes applied;
- final gates rerun;
- any advisory explicitly deferred without violating exit criteria.

Git history/PR discussion is the change record. The active docs remain concise sources of current truth.
### Narrative workspace and typography gate

`npm run browser:qa` also exercises the operational journal in Vietnamese at 1440px and 390px, with a 320px record/form check. Keep the record, appointment, receipt, section-navigation, native-dialog and keyboard-tab workflows in `scripts/workspace-redesign-qa.mjs` executable. Screenshots and the report belong to `output/workspace-qa/review` and are CI artifacts, not production data.

The font gate uses Chromium's actual glyph-to-font report for composed and decomposed Vietnamese accents; a CSS family name alone is not proof. Body text uses self-hosted Be Vietnam Pro and editorial headings use self-hosted Noto Serif through `next/font`. Do not restore machine-dependent font loading or browser font-CDN requests. Review fresh desktop/mobile captures after typography or responsive changes.

Operational modal surfaces must use `OperationalDialog`/`WorkspaceDialog`, not a div with `aria-modal`. `WorkspaceTabs` preserves each module's existing selection handlers while supplying roving focus and arrow/Home/End navigation. The associated source guards and keyboard unit checks run with `test:workspace`; real-browser checks remain the interaction evidence. Keep section numbers distinct from clinical stages and preserve the independent odontogram snapshots.

`test:workspace` also covers patient matching, composition/modifier keyboard handling,
and denied/quota-limited browser storage. `browser:qa` runs
`scripts/workspace-interaction-qa.mjs` only against a disposable loopback test app:
verify Arrow/Enter/Escape lookup behavior, persistent patient-directory selection
through reload/Back/Forward and clearing selection before reload,
native patient-menu modality/focus return, mobile empty-directory scrolling at
320/390/820px, and usable workspace/forms when storage property access throws.
The form-storage check never submits patient data. Reports and fresh screenshots
are under `output/workspace-qa/interaction-audit` in the browser CI artifact.
For client-side navigation, await the intended URL and visible destination before
asserting state; `networkidle` alone can describe the previous route.

Run `npm run test:maintainability` after query, parser, provisioning, command or UI
composition changes. This covers private staff DTOs, read-only getters, bootstrap
rollback, money/calendar validation, scope memoization, negative architecture fixtures,
all 44 command permission denials and sanitized diagnostics. It also enforces bounded
composers/models/commands and canonical shared helpers. TypeScript rejects unused locals
and parameters. Positive source guards follow actual composition imports; negative
transport guards inspect transport files alone.
Run `NODE_ENV=test npm run test:maintainability-db` against migrated disposable
PostgreSQL on loopback. It races native global sequence initialization, verifies private
profile fields stay out of clinical payloads, proves bootstrap rollback, and checks
repeat provisioning preserves customized inactive forms. CI also runs full runtime and
browser suites. Ordered legacy CSS imports retain the original cascade (hash regression);
new styles belong in the owning workspace stylesheet.

`browser:qa` also runs `scripts/money-input-browser-smoke.mjs` on a disposable
loopback app/database. It types amounts one key at a time in uncontrolled receipt
and controlled allocation inputs, checks grouping on blur, caret edits, decimal
suffixes and native rejection of invalid text, then reconciles two actual receipts
and two separate invoices against PostgreSQL. Keep this keyboard coverage:
`fill()` and direct Server Action tests do not reproduce caret/formatting defects.

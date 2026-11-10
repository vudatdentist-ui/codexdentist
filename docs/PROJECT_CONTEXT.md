# Codexdentist Canonical Product Context

Last updated: 2026-11-10
Status: ACTIVE / CANONICAL

> This file replaces every previous product direction, refactor queue, migration-route plan, and architecture context. Git history is an archive, not an active instruction source. Do not revive an older plan merely because it appears in a previous commit, chat, issue, or deleted document.

## 1. Source Of Truth

When instructions disagree, use this order:

1. Current repository code and database constraints for implemented behavior.
2. This file for product direction, architecture, invariants, and phase sequencing.
3. `docs/QA_PLAYBOOK.md` for verification gates.
4. `docs/OPERATIONS.md` for deploy, backup, restore, hosting, and runtime operations.
5. Git history only to understand why something exists; history must not override the active context.

The current baseline is the code on `main` after the August 2026 rollback. Treat that baseline as real implementation state. Previous frontend migration plans are cancelled unless explicitly reintroduced into this file.

## 2. Product Definition

Codexdentist is an open-source, all-in-one dental clinic operating system designed first for Viet Nam and for small/medium clinics that need practical self-hosting.

Primary product goals:

- One coherent dental operating system rather than a collection of loosely connected modules.
- Safe multi-clinic and multi-tenant operation.
- Strong clinical Journey/odontogram workflow.
- Correct billing and financial reconciliation.
- Protected patient files and auditable sensitive actions.
- Simple self-host deployment for a clinic while allowing optional external services when they add clear value.
- Vietnamese-first operational UX; architecture and infrastructure details must not leak into normal staff workflow copy.

PostgreSQL remains the canonical transactional store for Codexdentist core business state.

## 3. Non-Negotiable Invariants

These rules survive every refactor and integration.

### Tenant and authorization

- Hosted staff sign in at `https://codexdentist.com/login` and remain on that host. Organization and clinic scope comes from the authenticated account and stored session; subdomains are not required for workspaces.
- Signup, password recovery and staff setup use the shared application origin. Legacy workspace page links redirect to the shared host with their path/query preserved; dedicated demo/docs/odontogram/platform hosts retain their routing.
- Sessions use a host-only `codexdentist_session` cookie. Legacy shared-domain sessions require a fresh login after this rollout.
- `Organization` is the canonical tenant boundary.
- Business data is scoped by `organizationId` server-side.
- Clinic-owned data must additionally respect the actor's accessible clinic IDs.
- Mutation authorization is enforced on the server. UI visibility is never authorization.
- Patient portal identity is based on the explicit patient-to-user relation, never matching by email.
- Refactors must preserve negative cross-tenant tests.

### Clinical and Journey

- Journey remains the patient-centered longitudinal clinical workspace and timeline.
- Odontogram uses standard FDI codes and versioned snapshots with independent clinical stages.
- Temporary treatment selection must remain separate from persisted clinical chart state.
- Clinical write permissions, revision conflict handling, immutable history, and tenant/clinic isolation must not weaken.
- Refactoring presentation code must not opportunistically redesign clinical semantics.

### Billing

- Receipt collection, allocation, invoice issuance, refund/void, credit/unallocated balance, and service progress semantics remain separate concepts.
- Ledger mutations that depend on current balances remain transactionally safe; existing Serializable/concurrency guarantees and database constraints are preserved.
- Partial invoices are not merged after issuance.
- External payment providers may request or report a payment, but they never write Codexdentist billing tables directly.

Financial adjustment decision (2026-11-05): receipt amounts and allocations remain
gross historical collections; cash refunds are negative Payments with versioned
receipt shares and original commission bases in the same transaction's immutable
`invoice.refund_recorded` audit metadata. Retain that metadata with its Payments;
it is financial evidence, not disposable diagnostic logging. Legacy refunds with
missing attribution fail closed. Commission generation and adjustment use the
retained net basis, preserving other invoices on a shared receipt and fixed-fee
policy snapshots. Paid commission payouts require separate reconciliation.
Voiding a non-refunded invoice reverses its payment application, sets paid to zero
and releases direct allocations to credit exactly once; service collections stay
with their service. Internal `void_reversal` entries are not cash movements on the
patient statement. The current schema has no refunded-receipt bucket: void after
refund and service-linked cash refunds are explicitly unsupported. Reject them
before mutation rather than creating spendable refunded money or overstating
service collections. Amount adjustment is limited to an unsettled, unallocated
single-line invoice of quantity one. The refund form sends an intent tied to the
invoice payment-ledger version; replay cannot create another negative Payment.
Retained commission basis uses an immutable snapshot committed with generation,
or a validated legacy basis captured before a receipt-specific void release
linked to its reversal Payment. Transaction start timestamps do not establish
commit order; no timestamp alone excuses a ledger mismatch. Keep that evidence with
the financial ledger; commission validation covers all accruals rather than a
1,000-record preview.

### Patient files and PHI

- Patient files are protected records, never public assets.
- Every read is authorized by session, tenant, clinic, and linked patient rules as applicable.
- Upload validation remains content-aware and rejects unsafe active payloads.
- New file workflows must use a recoverable lifecycle so an object-store write cannot silently create unmanaged PHI when a database transaction fails.
- Logs, outbox payloads, integration metadata, and audit records must minimize PHI/PII.

### Data preservation

- No reset, reseed, truncate, destructive migration, or bulk deletion of real operational data without explicit user approval and a verified backup/restore path.
- A refactor is not permission to change business records.

## 4. Architecture Target

Codexdentist stays a modular monolith for its canonical dental core. Do not split Patient, Journey, Billing, Scheduling, or core Operations into network microservices merely to achieve modularity.

Target source layers:

```text
src/
├── app/              # Next.js routes, Server Actions, route handlers, composition
├── shared/           # business-agnostic UI/types/utilities
├── domains/          # business rules, domain types, domain events
├── features/         # application use-cases: commands, queries, policies, ports
├── infrastructure/   # Prisma/storage/crypto/jobs/audit implementations
├── integrations/     # external provider adapters and webhook adapters
├── workspaces/       # staff/patient UI composition
├── components/       # legacy migration territory
├── modules/          # legacy migration territory
└── lib/              # legacy/general technical code; migrate deliberately
```

This is a target, not a claim that the baseline already has every directory.

### Dependency direction

- `shared` is business-agnostic and cannot depend on higher business/UI layers.
- `domains` contains business meaning and must not depend on Next.js, Prisma, concrete storage, external providers, app routes, or workspace UI.
- `features` orchestrates domain use-cases and authorization/policy contracts. It must not depend on app routes, workspaces, or concrete external providers.
- `infrastructure` implements technical ports for persistence/storage/crypto/jobs/audit. It must not own business policy or UI composition.
- `integrations` adapts third-party systems to application contracts. It must not bypass application commands to mutate canonical domain tables directly.
- `workspaces` compose UI from features/domain read contracts; they must not call Prisma, object storage, or provider SDKs directly.
- `app` is transport/composition. Server Actions and route handlers should parse/authenticate/dispatch/map responses rather than contain duplicated domain business logic.

Legacy `src/components`, `src/modules`, and broad `src/lib` code are migration territory. Do not perform a rewrite solely to make paths look clean. Move code when a bounded use-case is being changed and can be verified behind the gates below.

## 5. Canonical Bounded Contexts

Use a small number of meaningful contexts rather than one module per screen:

- **Identity**: Organization, Clinic, User, role assignments, authorization policy.
- **Patient**: patient identity/profile, portal association and patient-scoped metadata.
- **Scheduling**: appointments, resources, calendar workflow.
- **Clinical**: Journey, odontogram, exams, plans, treatment services and clinical progression.
- **Revenue**: receipts, allocations, invoices, refunds, balances and accounting projections.
- **Operations**: service catalog, inventory, pharmacy, assets, lab and sterilization capabilities.
- **Workforce**: staff profile, compensation, payroll.
- **Engagement**: CRM, consent, communication and notification orchestration.
- **Imaging**: imaging-study references and authorization around external DICOM/PACS systems.
- **Interoperability**: external representations such as FHIR; never the internal source of truth.

Journey may present events from multiple contexts but does not need to own every underlying table.

## 6. Application Boundary

Business mutations must become reusable application commands/use-cases instead of living only inside Server Actions.

Target flow:

```text
Server Action ─┐
REST/API       ├──> Application Command ──> Domain/Policy ──> Repository Port
Webhook       │
Job/CLI ──────┘
```

Examples of commands that should have one canonical implementation:

- record receipt
- allocate receipt
- issue invoice
- refund/void receipt
- save/finalize clinical state
- attach/commit patient file
- schedule/reschedule/cancel appointment

Transport code may call a command; it must not maintain a second copy of the business rules.

## 7. Integration Architecture

External repositories and services are replaceable adapters or sidecars. They do not become the Codexdentist canonical database.

Before adding multiple providers, establish these concepts:

- `IntegrationConnection`: tenant/clinic provider configuration and capabilities.
- `ExternalReference`: stable mapping between internal and external entity IDs.
- `IntegrationInbox`: verified, idempotent receipt and processing state for external events/webhooks.
- `IntegrationOutbox`: domain/application events persisted with the canonical transaction and dispatched asynchronously/retryably.

Rules:

- Webhook verification happens before business processing.
- Duplicate external event IDs are idempotent.
- Retry/backoff is centralized rather than reimplemented per module.
- Provider failure must not roll back a successfully committed unrelated core transaction.
- Outbox payloads should carry IDs/minimal metadata rather than unnecessary PHI.
- Provider adapters invoke application commands; they do not import Prisma to write core domain records.

### Preferred integration roles

- **payOS**: payment-link/VietQR provider feeding Revenue commands.
- **Documenso**: optional signing engine for consent/document ceremony; Codexdentist remains owner of patient/consent/file/audit state.
- **Orthanc + OHIF**: optional DICOM/PACS + viewer sidecar; Codexdentist stores authorized study references and metadata, not DICOM blobs in PostgreSQL.
- **Notification provider/Novu**: optional implementation behind a Codexdentist notification abstraction.
- **Chatwoot**: optional conversation system; Codexdentist remains Patient/CRM source of truth.
- **FHIR/Medplum**: optional interoperability adapter; FHIR is an external representation, not the internal domain model.

Large sidecars must be opt-in deployment profiles, not mandatory dependencies for a small self-host clinic.

## 8. Patient File Lifecycle Target

New/changed patient-file workflows should converge on a recoverable lifecycle:

```text
STAGED -> COMMITTED
   |          |
   +------> GC_PENDING -> deleted
```

A staged object has enough metadata/checksum to be reconciled. Only a committed object is treated as a normal patient record. Failed/expired staged objects are discoverable and garbage-collected through an auditable job. Existing protected-file authorization remains mandatory throughout the migration.

## 9. Phase Execution Protocol

Every phase follows the same closed-loop process. A phase is not complete when code is merely written.

1. **Baseline**: record the relevant current behavior and run the phase's pre-change gates.
2. **Implement**: make the smallest coherent change that advances the phase objective.
3. **Static audit**: typecheck, encoding, architecture boundary checks, schema/migration review, and focused source review.
4. **Runtime/domain audit**: run required security, tenant, billing, file, integration, smoke, browser, or data-integrity tests for the touched surface.
5. **Classify findings**: blocker, high, medium, advisory.
6. **Fix**: resolve every blocker/high finding and every medium finding that violates the phase exit criteria.
7. **Re-audit**: repeat the same failing gates and relevant regression suite.
8. **Repeat** steps 5-7 until exit criteria are satisfied with zero unresolved blockers/high findings.
9. **Close phase** only when evidence satisfies all exit criteria. Do not weaken a gate to make a phase pass.

If a test exposes an existing baseline defect unrelated to the change, document it explicitly and either fix it safely in the phase or keep the phase open. Do not silently suppress it.

## 10. Phased Plan And Exit Criteria

### Optional-service completion — 2026-11-06

The owner requests completion of the remaining integration workflows, including
their app interfaces and optional self-host deployment. Base release `b5ffb83`
is already deployed and independently verified; do not redo its payment, consent,
clinical or financial refactors. Work in the following dependency order:

Cost constraint (owner clarification): no new paid API, cloud subscription or
enterprise-license dependency. A limited cloud free tier is not equivalent to
unrestricted free use. Prefer OSS community editions on the existing VPS and
native functionality where a required feature is commercially gated. Add offline
bank-transfer QR plus existing manual Revenue reconciliation; never imply a QR
proves payment. Preserve previous gateway history. Cloud AI/mail/storage currently
configured must be assessed for a self-host/local alternative without losing
patient files or abruptly breaking existing workflows. Never publish secrets or
claim an existing third-party account is free without billing evidence.

1. Shared encrypted, organization/clinic-owned optional-provider settings and
   root-approved outbound origins. Saved configuration remains disabled until a
   real provider probe succeeds for the exact unchanged credential version.
2. Orthanc/OHIF: private PACS and viewer, study-scoped authenticated DICOMweb,
   actual synthetic DICOM ingestion/viewing and unavailable-provider recovery.
3. Chatwoot/Novu: explicit scoped conversation and notification workflows, opaque
   stable external identities, minimized payloads, safe replay/uncertainty and
   disabled-provider fallback. Never send real patient messages in agent tests.
4. Medplum: discoverable, explicit one-way Patient synchronization using stable
   identifiers and the lossless FHIR mapper. No inbound clinical overwrite or
   second source of truth. Verify identity, retries and tenant/clinic denials.
5. Optional deployment/activation: separate persistent service storage, private
   networking, generated service secrets, pinned upstream images, restore checks,
   controlled synthetic acceptance and exact-main release. Existing core clinic
   behavior must work when every optional service is disabled.

Exit evidence must include real handler/native races, provider-contract tests,
rendered app states at 1440/390/320px, independent audit/fixes and deployed health.
An API-only connector or unstarted Compose profile is partial, not live acceptance.
The previous payOS gateway remains dormant unless separately configured; no
merchant account is required for the new offline bank-transfer path. Never
substitute fabricated cloud credentials. Self-hosted
service-generated credentials are valid only for those owned instances. Preserve
real records, current mail/AI/R2 configuration and existing deployment rollback.
Do not enable outbound patient jobs or delete files under an inferred policy.

Current evidence for issue #91: release `87f06bd` (PR #92) is deployed after
successful exact-main push CI, core backup/isolated restore, candidate/public
checks and independent go-live verification. It implements
offline NAPAS bank QR in Settings/Billing, four encrypted optional-provider
panels and patient-scoped Chatwoot/Medplum/Novu tools. Shared provider accounts
are atomically owned by one organization; disabled clinic overrides never fall
back to an organization account. Configuration versions fence concurrent save,
disable, rotation and provider operations even with identical timestamps.
Medplum uses conditional creation and version-matched updates so a late export
cannot overwrite newer remote demographics. Novu defaults to a self-hosted
in-app workflow, provisions opaque bound recipients without email, and requires
authenticated sent evidence; queue acceptance is insufficient.

The owned VPS now runs separate private community services. Actual adapter and
full Next/PostgreSQL acceptance exercised all four providers using synthetic QA
accounts/projects; no real patient messages or bank transfers were made. OHIF
3.13.14 is built from pinned commit `e4cd86153a1aaa429ef749330eaeefd4df96a88a`
at `/imaging/ohif/`; its reviewed responsive adaptation preserves provider
onboarding and investigational-use notices. Synthetic DICOM pixels rendered at
1440/390/320px; foreign-organization metadata/viewer requests were denied.
The optional stack cold snapshot `20261109T111052Z-123500b2` was restored into
separate volumes/networks with matching PostgreSQL/MongoDB counts and an
authenticated PACS index. Original core/sidecar volumes were not restore targets.

The four production connections are enabled and verified for the existing
`phuongthao` organization. Deployed owner Settings, Billing, Patients and Imaging
were exercised at 1440/390/320px; a marked synthetic Novu in-app test reached
authenticated `SENT` evidence. No real patient message or transfer was sent.
The financial audit is identical before/after deployment with zero mismatches.
A real bank
receiving account is an owner-entered clinic setting; never substitute the test
account. AI, private files and email now use the verified owned runtimes described
below; previous cloud credentials/original files remain private rollback custody.
Chatwoot's public staff login has separate HTTPS browser/API origins and was
rendered at 1440/390/320px. Publication additionally proves the installation form
is closed; an account API response alone is insufficient. Main and synthetic
accounts now use distinct ordinary service agents, with real cross-account
requests denied in both directions. The installation administrator's token is
not exported as an application credential.

Issue #91 remains open for the remaining free-runtime cutovers, in order:

1. Completed: cloud AI replaced by a resource-bounded private local model;
   structured Vietnamese operational drafts are verified in the app, with no cloud
   fallback or autonomous clinical/financial writes.
2. Completed: durable private file storage on the existing VPS, checksummed
   relocation of the existing original, coordinated database/file restoration,
   encrypted off-server recovery copy and a verified nightly backup timer.
3. Completed: cloud email replaced by private self-host SMTP after sender DNS,
   credential recovery, owned queue restoration and approved Gmail inbox acceptance.
4. Activate the free self-host signing engine with synthetic protected PDFs and
   complete consent reconciliation. Existing Documenso UI/connector tests are not
   evidence that a real signing service is already running.

Signing activation audit: signed-result import must verify the provider's returned
envelope ID before downloading any item. Provider requests reject redirects,
JSON responses are bounded to 64 KiB, and raw provider failure text is excluded
from application errors. These checks preserve the existing ceremony reservation,
protected-file staging and consent reconciliation; they do not activate signing.

Owned email implementation is in progress: `owned-mail` is an opt-in transport,
with private HTTPS/HMAC, a separately encrypted SQLite idempotency journal and
TLS submission to the owned SMTP service. Existing notification records remain
canonical. A lost acknowledgement keeps PROCESSING and only authenticated,
organization-bound receipt reconciliation may finish it; no automatic replay.
Credential bodies remain ephemeral in the core and are removed from the gateway
after terminal acknowledgement/expiry. The SMTP acknowledgement means accepted
by the owned MTA, not proof of placement in an external inbox. Test-only services
cannot satisfy production readiness. The initial deployment has no public port,
external network or core database access, and rejects external test recipients.
Native SQLite worker races, actual TLS SMTP, PostgreSQL claim races and full-app
password recovery/settings have passed locally, including 1440/390/320 UI.
The Windows and actual Node 22 Linux runs agree. Pinned real Maddy acceptance
also verifies TLS submission, its durable queue, the DKIM signature and body
hash, header-tamper rejection, sender denial and idempotent delivery inside a
networkless synthetic namespace. Both mail volumes and private configuration/
keys pass cold snapshot and worker-free restoration, including SQLite integrity
and authenticated encryption-key identity. Expiry removes encrypted message
payloads while retaining idempotency evidence. PR #99 passed full CI and merged
as `725f1d6`. Its isolated VPS mail installation is now prepared and accepted:
private TLS/HMAC/SMTP readiness, invalid-signature rejection, both persistent
volumes and keys restored without workers, and an authenticated encrypted
off-server recovery copy. Its verified nightly backup timer is enabled. The
persistent DKIM selector is `cdx202611`. On 2026-11-10, the existing single SPF
record was updated with the VPS IP and the persistent DKIM public key was added
through the owner's Cloudflare session; both exact TXT values match public DNS.
Inbound MX/mail records are preserved. PR #103 passed full exact-head CI and
merged as `7063012`. Its guarded initial outbound transition passed on the VPS:
fresh cold snapshot `20261110T022155Z-df893958`, worker-free restoration and
encryption, empty original queues, exact private configuration and signed TLS
readiness. Only the SMTP service gained outbound networking. A connection from
that namespace reached Gmail's MX on TCP 25 and received its SMTP banner, then
quit without submitting mail. The encrypted snapshot also passed authenticated
off-server decryption/checksums on the owned PC. On 2026-11-10 the owner approved
exactly one plain test email. It reached Gmail's Inbox in three seconds with the
matching Message-ID/nonce; Gmail's original-message view confirms SPF, DKIM and
DMARC PASS for the owned IP/selector. No patient data or authentication link was
sent. The one-message authorization is consumed; do not send another under it.

Production now uses `NOTIFICATION_DELIVERY_MODE=owned-mail` on the same verified
`31210f1` image. The cutover snapshots/restores current database/files first,
requires no in-flight old-provider email and compares resolved Compose before
recreating only the core service. Only the private mail gateway network,
read-only public CA and five controlled mail environment values change. Original
Resend keys/configuration remain in private rollback custody. Independent go-live,
signed live-mail readiness, all five app checks and public routes pass; the
financial ledger is unchanged. Existing owner Settings shows the clinic mail
server, correct sender and ready state at 1440/390/320px without submitting more
mail. A failed pre-cutover comparison exercised exact rollback before activation;
its evidence is retained. Further work remains under signing below, not SMTP
transport activation. Inbox delivery to one approved Gmail account is evidence
for that acceptance, not a promise about every future destination.
PR #106 is merged and deployed as `e0f1f96` after exact-main CI `42789283529`,
fresh backup/restore, independent go-live/readiness and unchanged ledger. The
post-cutover mail snapshot `20261110T085642Z-2d52bd3f` passed authenticated encrypted
PC recovery, including the existing mail receipt/journal state.

Signing preflight also passed against actual Documenso 2.21.1 CE in a separate
synthetic installation: the reviewed adapter created/distributed a PDF, the
browser inserted a signature and completed it, and the adapter downloaded the
sealed result. Its CMS signature verifies against the owned test certificate;
tampered bytes fail verification. Completed screens were inspected at desktop
and phone sizes. SMTP stayed in a private capture service with no external
network, paid key or patient data. Those four QA services were stopped afterwards;
their private proof/volumes are retained. This is not operational activation:
owned deployment/recovery, explicit Vietnamese date/time presentation, minimal
provider logging, core webhook/reconciliation and real recipient delivery remain
part of the signing gate after mail is accepted.

The separate owned signing standby now runs pinned CE with its own database,
Valkey and internal mail capture, closed signup and no public route/core access.
Actual health validates both database and certificate; a valid signup request
must return `SIGNUP_DISABLED`. Runtime logs are disabled because upstream job
errors can contain recipient addresses/tokens. Valkey runs directly as its
image's unprivileged UID: restart acceptance found that the root entrypoint
could not traverse its private AOF directory with capabilities dropped. The fix
preserves permissions and adds authenticated PING/restart checks; Docker's
`Running=true` while restarting cannot satisfy status. Cold snapshot
`20261110T022102Z-26de05ec` restored all bytes/ownership/modes, every PostgreSQL
table count, Valkey AOF/authentication and the certificate passphrase without
starting restored application, mail or job workers. This remains a private
standby, not activation of consent signing. Service-account provisioning,
recipient publication and core ceremony/webhook acceptance remain separate gates.

The private foundation is merged in PR #104 and deployed as `31210f1` after
exact-main CI `42746106360`, core backup/restore, independent go-live/readiness
and unchanged ledger. Snapshot `20261110T023256Z-34bb70da` additionally verifies
restored deployment configuration ownership and actual app-UID key/cache access.
Its CMS AES-256-GCM/RSA-OAEP-SHA256 copy is on the owned PC; authenticated
decryption verified every volume/configuration/key checksum in memory. The real
recipient private key remains only on that PC. Off-server transfer is manual.

`owned-signing-bootstrap.py` implements the next private stage: it requires only
the two seeded CE placeholder users and zero envelopes, snapshots/restores first,
temporarily permits signup only within the four-service internal network, then
creates separate main/QA identities through actual verification/signin/token
APIs. It restores the exact closed configuration even on failure. A retained
intent/partial acknowledgement prevents replay; API keys bind to their stored
user/team/token hash, not merely a successful API response. Both identities have
passed creation and authenticated API acceptance on fresh isolated CE, including
cross-owner token substitution denial. PR #105 passed exact-head CI and merged
as `65b7337`; its operator also bootstrapped both identities on the owned standby
and verified the closed APIs. Fresh snapshot `20261110T085052Z-81c3706e` includes
their private credentials, passed worker-free PostgreSQL/AOF/config restoration,
and its encrypted copy passed authenticated recovery on the owned PC. No public
route, recipient email or core signing connection has been enabled. Those
publication and full-app ceremony/webhook/replay gates remain open.

The next signing gateway is implemented and running privately: pinned
unprivileged Nginx exposes a strict-TLS API listener only on an internal network
and a separate recipient surface. Recipient routes allow required assets,
read-only session status and token-scoped PDF retrieval, plus enumerated signing
procedures; admin/signup/signin/API-key/bulk-API and batched-procedure smuggling
are denied. Access/error logs are disabled to keep signing tokens out of logs.
Actual TLS/API/route-denial probes pass. No published port, external network,
public router or core connection has been enabled.

A synthetic QA ceremony used the reviewed adapter through the TLS gateway,
inserted/completed a browser signature and downloaded the sealed PDF. Its CMS
verifies against the owned certificate and tampered bytes fail; its stored
metadata is explicitly `Asia/Ho_Chi_Minh` and `dd/MM/yyyy HH:mm`. Final exact
"Everyone has signed" screens were inspected at 1440/390/320. Browser QA used a
temporary private loopback origin through an SSH tunnel because the real hostname
is not published; the exact original provider Compose/origin was restored and
the tunnel closed afterwards. This does not satisfy public-hostname or core
consent/webhook acceptance. Owned snapshot `20261110T092919Z-9bd9f71b` also passed
combined provider/gateway key/configuration recovery and authenticated encrypted
PC custody. The initial fresh gateway fixture exposed a generated 64-character
upstream DNS label; using the scoped Compose `app` alias fixes that failure without
changing TLS or the isolated provider network. The reviewed private upgrade
preserves exact previous files and refuses unrelated/concurrent edits. Final
native acceptance passed on a fresh isolated CE stack, including both API owners,
TLS/route denials, repeated combined restoration, corruption denial and authenticated
encrypted recovery. Owned snapshot `20261110T094026Z-f13bc1d7` preserves the upgraded
DNS configuration and passed restoration plus authenticated PC recovery. Exact-head
CI `42792874203` passed for PR #107, which merged as `953910c`; exact-main
verification/deployment and public/core gates remain required; signing stays open.

The next recipient operator separates the HTTP ceremony into its own unprivileged
process. Its only bind is the allowlisted HTTP configuration: no API TLS listener,
private key, provider credentials or host port. Only this process may join the
existing proxy edge; the private API gateway retains internal-only networks.
It reaches the existing allowlisted recipient listener on its isolated ceremony
network and never joins the provider's application/database network directly.
The dedicated `sign.codexdentist.com` router disables access logs and tracing for
both HTTP/HTTPS without changing other routers. Publication requires the exact
four-file recipient configuration in a completed combined restoration. Failure
removes only its own unchanged router and restores its own manifest; foreign
concurrent changes require review. Fresh native proof `signing-recipient-proof-v2-20261110`
passed its actual edge/port denials, repeated restoration, authenticated encryption
and complete labelled cleanup. An initial cleanup variable collision was fixed;
the gate now writes its final pass artifact only after cleanup succeeds. The owned
frontend is staged with no public router, email or core connection. Exact-head CI,
combined owned recovery and actual public-hostname ceremony remain required;
implementation alone does not activate core signing.

Next activation sequence: keep private API and public recipient frontends on
separate processes/networks before attaching only the recipient frontend to the
existing proxy. Publish only a dedicated signing router with token-safe access
logging, then repeat the actual ceremony on the real HTTPS hostname. Add a private
authenticated callback route and verified owned SMTP submission, bind distinct
provider accounts to the real main/test organizations and exercise the complete
core consent/PDF/webhook/import/replay flow with synthetic fixtures. Drain and
review captured jobs before switching SMTP; never release old synthetic jobs or
use a real patient/credential email for QA. Snapshot/restore/encrypt the final
configuration before closing signing. Existing other VPS applications and inbound
mail remain outside this change.

Local AI is deployed in `2face1e` (PR #95), with the production configuration
cutover independently verified on 2026-11-09. The owned VPS has Ollama 0.40.15 and
Qwen3 4B pinned by image/model digests. Runtime has no published port or external
network, cloud features disabled, a read-only model cache and bounded CPU/memory.
The native adapter needs no API key and never falls back to a cloud endpoint.
Structured schemas constrain operational/accounting output; the application
rejects input echoes or malformed answers before recording success. Provider
failure bodies are not persisted in errors. Dashboard context uses the same
complete clinic aggregates as the screen, not capped previews or metric-array
lengths. The assistant remains draft-only and cannot write clinical/financial data.
Full Next/PostgreSQL/owned-model acceptance now covers grounded zero-appointment
data, Vietnamese structured output, pending/disabled submit, unavailable-model
feedback and unchanged clinical/financial tables at 1440/390/320px. Production
AI now uses `ollama:qwen3:4b`, with the old environment retained privately for
rollback. Exact-main push CI, core backup/restore, go-live/readiness, effective
runtime inference, owner UI and unchanged financial audit pass. The independent
production inference used only synthetic data and made no database writes.
Model cache snapshot `20261109T121524Z-bcfd9e53` passed isolated restoration with
matching SHA-256 for every file and the pinned model metadata. Email has completed
its separate owned SMTP cutover; private files use the owned volume below.

Durable private filesystem storage is deployed in `88a6244` (PR #97), with exact
main CI `42630373297` passing. Production writes to `local` on the private named
volume; its one original (41,744 bytes) was copied and checked before an audited,
concurrency-fenced metadata/stage transaction. The protected download and retained
R2 original both match the stored SHA-256. Clinical metadata and organization/
clinic scope are unchanged. Final inventory has one local file, one matching
COMMITTED local stage, no R2 file references and no learning/staff/accounting
assets. Historical R2 credentials/objects remain available for reviewed rollback.
The implementation uses explicit `PATIENT_FILE_LOCAL_DURABLE=true`, an exact
Linux mount outside the release, app UID ownership and mode 0700. Files are 0600;
path traversal and directory/leaf symlinks fail closed. Existing R2 reads are
independent of the selected write backend. The operator relocation CLI journals
and fsyncs its verified candidate before atomically moving both the file and its
single cleanup stage; uncertain commits preserve evidence, never queue candidate
deletion. It currently accepts checksummed originals without variants, matching
the live inventory; files with variants require a separately reviewed migration.
Mounted Linux, actual S3 reads, interrupted-commit recovery, native PostgreSQL
races/retention and networkless file restoration have passed. Actual app PDF/image
upload, previews and protected downloads pass at 1440/390/320px. Fresh production
owner UI, all five readiness checks, the independent go-live verifier and the
unchanged financial/login-mapping audit pass after cutover. The mobile timeline
status no longer overlaps its author/title; the frozen legacy CSS remains intact.
Snapshot `20261109T142337Z-periodic-88a6244b84d8` passed separate database and
file-volume restoration. Its encrypted copy was downloaded to the owned PC and
authenticated/decrypted in memory, checking every private file and dump archive
without writing plaintext patient data there. The root-owned nightly timer is
enabled only after that complete acceptance. Next: free SMTP with authenticated
sender/DNS and credential recovery, then real self-hosted consent signing.

### Current delivery plan — 2026-11-05

User-facing completion loop: plan a complete operational path, implement it,
exercise the real app, independently audit/fix/retest, then choose the next gap.
An integration with API handlers but no discoverable configuration and staff
workflow is **partial**, even when its backend tests pass. Do not report it as a
completed application feature.

| Workstream | Current state | Required operational acceptance |
| --- | --- | --- |
| payOS operator workflow (#78, PR #79) | Implemented and re-audited; native and rendered app gates cover the operational path. Real merchant activation awaits owner credentials. | Tenant/clinic-owned encrypted credentials; signed webhook setup; invoice QR/link/history; lost-response retry and exact-once receipts; negative scope tests; production UI plus full local app browser gates at 1440/390/320px. Verify release separately from implementation. |
| payOS terminal recovery (#86) | Explicit signed provider-status checks extend the deployed operator path. | Only confirmed CANCELLED/EXPIRED requests with zero paid amount may retire their QR and release credential replacement. Paid/partial/unknown/unverified observations never settle or clear uncertainty; concurrent settlements and retired requests remain durable. |
| Documenso operator workflow (#80, PR #82) | Settings and consent signing UI implemented and re-audited; native, full-app and production UI gates pass locally. Real service activation awaits operator credentials. | Tenant-owned encrypted keys; eligible protected PDF attachment; recipient-bound send/resume; durable status; signed file with reconciliation provenance; scope/demo/race/failed-import/replay gates. Verify current exact-main CI and deployment marker before claiming rollout. |
| Imaging and native operations | Lab/sterilization UI has local/CI evidence; live PACS remains unconfigured. | Preserve verified native flows; separately configure and accept an actual private PACS/viewer before enabling it. |
| Operational rollout | Read the running image revision and `/opt/codexdentist-deploy/current.json`; issue #78/#80 carries verified rollout evidence. Core fallback `d80318c` was independently verified; #71/#75 resolved. | Exact-main CI, backup/restore/runtime grant/candidate/public checks after each release; provider live acceptance requires real operator credentials. |

Credential decision: a dedicated IntegrationCredential stores authenticated
encryption envelopes, never raw keys in connection metadata, audit or client
DTOs. AES-256-GCM binds organization, connection and provider in associated data;
HKDF separates its key from authentication. INTEGRATION_SECRET_KEY may provide a
dedicated 32-byte base64 master; otherwise the existing AUTH_SECRET is the master.
Back up and retain the selected master before rotation or restoration. Existing
environment-based payOS merchants require an explicit organization binding.
Settings replacement and payment-intent reservation share a connection lock;
unresolved orders block credential replacement/disable. HTTP provider calls occur
after the transaction commits. A stored credential is not proof of readiness:
the owner must complete the signed webhook verification handshake.
Creation uncertainty survives subsequent rejected attempts. New definitive
rejections permit credential correction; an older uncertain creation still blocks
replacement. A late verified payment for a voided invoice becomes patient credit,
without reviving or allocating that invoice. Inbox readiness and retry scheduling
use the database clock so app/DB clock skew cannot distort delivery backoff.
Reported money awaiting a canonical receipt blocks fresh payment intents and
replays on the server, before decrypting keys or contacting payOS. The guard
covers all merchant connections for the same organization/clinic/patient/invoice,
including unallocated credit requests. Other invoices remain independent. Only
canonical settlement releases the guard; settled replays never return an old QR.

Signing decision: a Documenso request owns its form, source PDF and recipient
identity once reserved. Credential replacement, source changes and manual
completion/void cannot race an active or uncertain ceremony. A definitive creation
rejection permits manual completion/void and credential repair; it does not prove
the source may be replaced in an existing ceremony. Retrying a known envelope
resumes its original ceremony without distributing twice; unknown creation needs
trusted callback recovery. Patient email/name changes block resending the old
recipient's envelope. Only the reconciled signed-file provenance supports an
electronic-signing completion claim; manual form completion remains distinct.
The settings panel reports saved credentials and observed valid notifications
separately; saving keys is not live-provider verification.

The November release combines PR #68 (re-audited Phase 3–7 integration), #70
(local in-app notifications), and #72 (Revenue/commission integrity). Historical
drafts #34/#41 are closed as superseded; do not merge them over current main.
Current dependencies, shared-host login, UI architecture and VPS deployment are
preserved. Read the actual running revision from the image label and
`/opt/codexdentist-deploy/current.json`; a merged PR alone is not deployment proof.

The integrated milestones retain these independent exit gates:

| Milestone | Required result | Exit evidence |
| --- | --- | --- |
| Phase 3 | Integrate payOS/Documenso and safe provider configuration with current Revenue, consent and protected-file contracts. | Verified signatures, duplicate/reordered events, settlement reconciliation, signed-file rollback/GC, negative tenant/clinic tests, current CI and independent audit. |
| Phases 4–5 | Integrate scoped imaging/viewer access, native lab cases and sterilization traceability. | Stable patient references, permission denials, transitions/data integrity, unavailable-PACS behavior and fresh desktop/mobile browser evidence. |
| Phase 6 | Integrate optional standards adapters with the existing notification boundary. | Disabled providers preserve core workflows; mapping, authorization, PHI minimization and tenant tests pass. |
| Phase 7 | Release the integrated product with current Hostinger operations. | Full regression/build/container gates, clean install/upgrade, backup plus isolated restore, candidate checks, deployed revision and public health verification. |

Current evidence: the integrated implementation is merged through PRs #68/#72/#76.
The payOS credential branch adds a CREATE-only 58th migration; native PostgreSQL
clean install and encrypted-vault isolation pass. Provider signatures/retries/consent,
concurrent invoice settlements, tenant isolation, file lifecycle/purge and restore
tests pass locally. Lab and sterilization operator workflows pass real-browser
create/transition/reload/audit checks at 1440/390/320px; unconfigured imaging fails
safely without losing input. Exact-head PR CI and the integrated main push CI
passed. Financial verification includes 63 audit tests, actual partial/refund/void
and shared-receipt races, immutable commission basis snapshots, both transaction
commit orders, exact decimal cents and visible desktop/mobile safety denials.
The six new migrations pass isolated production-data restoration. The VPS upgrade
exposed a separate DDL-principal mismatch: restoring as superuser had hidden the
runtime account's missing REFERENCES/ownership permissions. The deployer now
uses the bootstrap migration identity only for DDL and verifies limited runtime
CRUD after restore; the role regression reproduces the original denial and
forward recovery. No historical migration is edited or core runtime role elevated.
PR #74 records the verified deployment of `a3aa571`: exact-main CI, production
backup/restore, all 57 migrations, candidate/runtime grants, formal go-live and
public/authenticated readiness passed. No unresolved attention marker remains.
PR #76 deployed as `d80318c` closes #75: URL, editable record, topbar and AI context
agree on the authorized patient; changing patients clears unsent drafts/actions.
Its focused tests, real navigation/browser review and verified release passed.
Optional live providers and application-job activation
remain separate operator configuration; see `OPERATIONS.md`.
Recovered migration history: `20260516090000_source_commission` has
ledger checksum `578975509b6eede77797d42ece4d3f93ee5635c8b218abb4894b7191537efae7`
but release SQL checksum `d31229374b52e7a29228b90fe34afbb9d664a9acdee31c530a3a3288f068ba9b`.
The original local checkout has the exact applied bytes: 51 LF lines and one CRLF
line. Normalizing line endings makes it byte-equivalent to Git's SQL. Readiness
and go-live use the archived original bytes to verify this one historical variant;
any SQL edit, unrelated name or unknown checksum still fails. The production ledger
and historical migration files remain unchanged. See issue #69.
Live payOS/Documenso/PACS acceptance remains pending operator-owned credentials.
The production audit isolated two invoice/payment mismatches to exact historical
seed fixtures in the test tenant, distinct from the main tenant. Issue #71 is
closed after the reviewed, backed-up correction and independent reconciliation.
Invoice headers, credit and clinical records were preserved. New seeds are
balanced/repeat-safe and refuse production or
remote targets. Never run the general seed to repair operational data.
Preserve all November shared-login and patient
audit fixes and October security/maintainability gates. Reuse completed work;
do not rebuild equivalent modules or revive Namecheap deployment. Optional
providers remain disabled until explicitly configured; sandbox verification and
live-provider evidence must be reported separately. A phase is closed only when
its current exit evidence passes; this table is updated as milestones close.

### Phase 0 — Reset Context And Enforcement

**Objective**

Remove stale product/refactor instructions and make repo tooling enforce only the active architecture direction.

**Implementation scope**

- Replace old product context with this canonical context.
- Update agent guidance and QA playbook to this phase/gate model.
- Remove retired migration-route assumptions and legacy target names from architecture audit tooling.
- Teach architecture audit about `infrastructure` and `integrations`.
- Remove obsolete deploy-target references that can be mistaken for current product direction while preserving useful operational safety guidance.

**Exit criteria**

- Active docs contain no previous migration-route queue as an instruction.
- `agent-module-audit` contains no hard-coded old migration routes or `DentalSuite/AppViewPage` migration policy.
- New architecture layers have enforceable dependency rules.
- `encoding:check`, `typecheck`, and `agent:audit` pass on the branch.
- Documentation and tooling agree on the same architecture direction.

### Phase 1 — Extract The Application Boundary

**Objective**

Move reusable business mutation logic out of transport/UI code without changing business semantics.

**Order**

1. Revenue/Billing commands first.
2. Journey patient-file/comment/finalization commands.
3. Patient commands.
4. Scheduling commands.

**Exit criteria**

- Touched Server Actions/route handlers are thin transport adapters.
- Each migrated mutation has one canonical application implementation usable by UI, webhook, job, or API.
- Tenant/clinic and action permissions are enforced at the application boundary or an equally mandatory server boundary.
- No duplicated billing/clinical mutation implementation is introduced.
- Existing billing concurrency, tenant, security, data-integrity, Journey/file tests for touched areas pass.

### Phase 2 — Integration Substrate And File Consistency

**Objective**

Create safe primitives needed by all external integrations and eliminate unmanaged-object failure modes in new file workflows.

**Implementation scope**

- Add integration connection, external reference, inbox and outbox persistence.
- Add idempotency constraints and processing/retry state.
- Add an outbox dispatcher contract and auditable retry behavior.
- Introduce staged/committed/GC lifecycle for new or migrated patient-file writes.

**Exit criteria**

- Duplicate webhook/event delivery cannot create duplicate domain mutations.
- A committed domain mutation plus outbox event is atomic where required.
- Provider outage/retry does not corrupt canonical business state.
- Failed DB/file sequences leave a discoverable staged object rather than unmanaged PHI.
- Tenant/security/patient-file/data-integrity tests and new inbox/outbox/file-reconciliation tests pass.

### Phase 3 — First Production Integrations: payOS And Documenso

**Objective**

Prove the integration substrate with high-value providers without coupling provider data models to core domains.

**payOS exit criteria**

- Payment-link creation is tenant/clinic scoped.
- Webhook signature verification occurs before inbox acceptance/processing.
- Duplicate, delayed, and reordered webhook scenarios are idempotent.
- Settlement invokes Revenue application commands; provider code does not write billing tables directly.
- Billing concurrency/reconciliation remains green.

**Documenso exit criteria**

- Consent/form ownership remains in Codexdentist.
- Signing request uses minimized external data.
- Signed result returns through verified/idempotent integration processing.
- Signed PDF enters the protected staged/committed patient-file lifecycle.
- Consent, file, Journey/timeline and audit state reconcile after retry/failure tests.

### Phase 4 — Imaging: Orthanc And OHIF

**Objective**

Add production-grade DICOM/PACS viewing without turning DICOM storage into Codexdentist database state.

**Exit criteria**

- Codexdentist stores tenant/clinic/patient-scoped imaging references and stable external IDs.
- DICOM blobs remain in Orthanc-managed storage.
- Viewing requires Codexdentist authorization and cannot cross tenant/clinic boundaries.
- Environment-backed Orthanc credentials require an explicit `ORTHANC_DEFAULT_ORGANIZATION_ID` matching the authenticated setup organization and the stored connection owner at import/viewer resolution; legacy unbound connections fail closed.
- Patient mapping uses stable identifiers, not name/email heuristics.
- Backup/restore and unavailable-PACS behavior are documented and tested.
- OHIF access path works at desktop/mobile widths required by the supported workflow.

### Phase 5 — Native Dental Operations Gaps

**Objective**

Implement dental-specific gaps natively instead of importing another PMS architecture.

**Initial priority**

- Lab case/order workflow.
- Sterilization cycle/instrument traceability where operationally justified.

**Exit criteria**

- New models follow canonical tenant/clinic/audit rules.
- No second Patient/Appointment/Billing source of truth is introduced.
- Workflows integrate through existing Clinical/Operations contexts and Journey events where useful.
- Data-integrity, tenant, permissions, smoke and browser checks pass.

### Phase 6 — Optional Communication And Interoperability

**Objective**

Add replaceable communication and standards integrations only after core boundaries are stable.

**Exit criteria**

- Notification providers sit behind a Codexdentist abstraction.
- Chatwoot, if enabled, owns conversations but not canonical Patient/CRM identity.
- FHIR/Medplum mappings are anti-corruption adapters and do not reshape the internal schema merely to mirror FHIR resources.
- Optional sidecars can be disabled without breaking the core clinic workflow.
- PHI minimization, webhook idempotency, auditability and tenant isolation are verified.

FHIR identity decision (#88): the canonical patient has one unstructured full
name. Export that value in `HumanName.text`; never infer family/given boundaries
from token position. Keep stable patient identifiers, tenant/clinic authorization,
minimal export audit and the disabled-by-default provider gate unchanged. Structured
name parts require explicit source fields, not a cultural ordering heuristic.

### Phase 7 — Release Hardening

**Objective**

Prove that the refactored/integrated system remains safe to deploy, upgrade, back up and restore.

**Exit criteria**

- Full go-live gate passes.
- Self-host compose/build gate passes.
- Clean install and upgrade path are verified.
- Backup plus disposable restore drill passes after migration batches.
- No unresolved blocker/high architecture, security, tenant, billing, file-integrity or integration finding remains.

## 11. Architecture Guardrails

These are review-blocking rules:

- No external provider directly mutates canonical Patient, Journey, Billing, Scheduling, or protected-file business state through Prisma.
- No other dental PMS is merged wholesale into Codexdentist core.
- No external provider becomes source of truth for Patient, Journey, Billing, or core authorization.
- No mandatory deployment bundle of every optional platform/sidecar.
- No PHI-heavy outbox/log payload when a stable internal ID is enough.
- No UI-only authorization.
- No route/UI refactor is allowed to weaken tenant, billing, Journey, protected-file, payroll/compensation, or audit invariants.
- No broad rewrite when a strangler migration can preserve production behavior and test coverage.
- Do not add a new architecture concept without adding or updating an enforceable audit/test for it when practical.

## 12. Definition Of Done For Any Phase

A phase is complete only when all of the following are true:

- Its objective is demonstrably implemented, not merely documented.
- Every exit criterion has objective evidence.
- Required tests pass without disabling safeguards.
- Static architecture audit reports no blocker/high violation in new architecture code.
- Relevant negative tenant/security tests remain green.
- Data migrations are reversible or have a verified restore path.
- Operational docs are updated when deployment/storage/jobs change.
- Re-audit after fixes is green.

Until then, the phase remains open.
Maintainability boundaries: clinical participant selectors use the scoped staff directory DTO,
which excludes profiles, salary and contract data. Settings reads require settings roles.
Workspace queries never provision catalogs. Defaults are created during organization
bootstrap in the same transaction as the owner/clinic; repeat provisioning preserves
customized entries. FRM/RX printable numbers use one atomic global counter per type/year
to match their existing global unique indexes, initialized above existing document numbers.
Settings, workforce and inventory mutations use typed application commands with their
own permission/scope validation; Next.js transports parse forms and map notices only.
Large UI composers delegate to model, view, named sections and pure projections.
Patient lookup components and pure matching live in `src/workspaces/patients`;
legacy composition imports forward to that owner. Keep canonical patient-code and
search-normalization helpers shared. Lookup selection in the patient directory
opens a persistent patient URL; Back/Forward and clearing selection keep the
topbar and dossier aligned with that URL. Journey lookup keeps keyboard focus in its
combobox and the patient menu uses the shared native modal. Browser preferences
and action-scroll storage are optional: denied storage access must not prevent
opening a workspace or editing a form.
Journey distinguishes unavailable patient data, an empty scope, no selection,
an invalid link and a pending patient switch. A mismatched URL hides editable
record content and clears patient context in the topbar/AI. No selected Journey
patient means no patient workspace is serialized into an AI request. Temporary invalid
navigation preserves hidden comments, attachments and treatment targets for Back;
a different valid patient gets
a new owner for draft fields, attachments and pending dialogs. Server-side
tenant/clinic/action authorization remains mandatory regardless of UI state.

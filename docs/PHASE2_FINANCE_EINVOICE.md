# Phase 2 — Finance + E-invoice Operational Loop v1

## Goal

Connect the existing treatment/billing ledger into one operational loop:

`Treatment service → Collection → Receipt allocation → Invoice → E-invoice state → Reconciliation → Work`

The phase must improve access and operational visibility without replacing existing billing invariants.

## Existing facts that remain authoritative

- `TreatmentService` is the operational treatment object.
- `Receipt` represents money received.
- `ReceiptAllocation` connects a receipt to a treatment service and/or invoice.
- `Invoice` and `Payment` keep their current ledger/concurrency semantics.
- Billing action permissions remain server-side authority.
- Tenant/organization/clinic scope is mandatory.

## Phase deliverables

1. Canonical Finance workspace at `/operations/finance` for Owner / Area Manager / Clinic Manager / Billing.
2. A server-only Finance read model that joins:
   - treatment service financial state,
   - receipts and unallocated balances,
   - invoices and payments,
   - E-invoice operational state,
   - reconciliation findings.
3. Provider-agnostic E-invoice adapter contract.
4. E-invoice state machine:
   - `NOT_REQUIRED`
   - `PENDING`
   - `ISSUED`
   - `FAILED`
   - `CANCELLED`
   - `REPLACED`
5. E-invoice state persisted as append-only `AuditLog` events in v1. This is deliberate until a real provider contract is selected; no provider-specific schema is invented.
6. Manual external reconciliation for invoices issued/cancelled/replaced outside Dental OS.
7. Provider request/sync actions. If no provider is configured, fail explicitly with `PROVIDER_NOT_CONFIGURED`; never fabricate issuance.
8. Derived Finance Work signals for:
   - failed/stale E-invoice operations,
   - local void vs external issued mismatch,
   - invoice amount changed after external issuance,
   - receipt amount not fully allocated,
   - treatment collection not yet invoiced,
   - invoice/item/payment reconciliation mismatch.
9. Operations navigation exposes Finance without giving Front Desk the manager Operations workspace.
10. Desktop/mobile Browser QA + deterministic Finance/E-invoice E2E coverage.

## Safety invariants

- No weakening of billing serializable transaction behavior.
- No rewrite of existing receipt/invoice/refund/void transaction semantics in this phase.
- No fake provider success in production.
- No clinical/odontogram/payroll semantic changes.
- No cross-tenant or cross-clinic reads/writes.
- Work signals are derived; they do not mutate ledger rows.
- E-invoice actions require existing billing invoice permissions.
- An externally issued invoice cannot be silently treated as cancelled when the local invoice is voided; the mismatch must remain visible until reconciled.

## Acceptance loop

Repeat until clean:

1. Compare implementation against this contract.
2. Execute implementation.
3. Run architecture/type/build/security/tenant/billing/data-integrity audits.
4. Run Browser QA and Finance/E-invoice E2E.
5. Fix every regression or contract gap.
6. Compare against this contract again.
7. Re-run all gates on the final HEAD.

Do not merge or deploy as part of this phase.

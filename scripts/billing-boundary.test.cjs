const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

test('refund transport requires a bounded intent and forwards it to the authorized command', async () => {
  const calls = [];
  const service = load('src/app/(app)/billing/actions.ts', {
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect(url) { throw new Error(`REDIRECT ${url}`); } },
    '@/lib/auth': { requireViewSession: async () => ({ userId: 'owner' }) },
    '@/lib/error-reporting': { reportApplicationError() {} },
    '@/lib/application/revenue/commands': { recordInvoiceRefundCommand: async (...input) => { calls.push(input); } },
  });
  const form = key => ({ get: field => ({ invoiceNo: 'INV', amount: '50000', method: 'cash', idempotencyKey: key })[field] });
  for (const key of [undefined, '', 'x'.repeat(129)]) {
    await assert.rejects(service.recordInvoiceRefundAction(form(key)), /REDIRECT .*billing-refund-intent-missing/);
  }
  assert.equal(calls.length, 0);
  await assert.rejects(service.recordInvoiceRefundAction(form('invoice:1')), /REDIRECT .*billing-refund-recorded/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].idempotencyKey, 'invoice:1');
  assert.equal(calls[0][1].amount, 50000);
});

test('all financial safety denials have actionable Vietnamese and English notices', () => {
  const { visibleActionNoticeParam, shouldKeepActionNotice } = load('src/lib/action-notices.ts');
  assert.equal(shouldKeepActionNotice('billing-refund-recorded'), false);
  const { noticeText } = load('src/modules/billing/billing-shared.tsx', {
    'react/jsx-runtime': {}, '@/components/AppLanguage': {}, '@/components/suite-primitives': {},
    '@/lib/data': {}, '@/lib/billing-presentation': {}, '@/lib/patient-presentation': {},
  });
  for (const code of ['billing-money-invalid', 'billing-invoice-adjustment-locked',
    'billing-invoice-refund-void-unsupported', 'billing-invoice-ledger-unreconciled',
    'billing-refund-ledger-unreconciled', 'billing-refund-history-unreconciled',
    'billing-refund-commission-unreconciled', 'billing-refund-paid-commission-unsupported',
    'billing-refund-service-linked-unsupported', 'billing-refund-method-unsupported',
    'billing-refund-reference-conflict', 'billing-refund-intent-missing']) {
    assert.equal(visibleActionNoticeParam(code), code);
    assert.equal(shouldKeepActionNotice(code), true);
    for (const language of ['vi', 'en']) {
      const notice = noticeText(code, language);
      assert.ok(typeof notice === 'string' && notice.length > 20, `${code}/${language}`);
      assert.doesNotMatch(notice, /PostgreSQL|database|billing-/i);
    }
  }
});

test('void application reversals preserve customer credit without inventing cash refunds', async () => {
  const date = new Date('2026-11-05T00:00:00Z');
  const invoice = { id: 'invoice', invoiceNo: 'INV', patientId: 'patient', clinicId: 'clinic',
    patient: { id: 'patient', fullName: 'Synthetic' }, amount: 100000, paidAmount: 0,
    status: 'VOID', dueDate: date, createdAt: date, _count: { payments: 2 }, items: [] };
  const empty = { findMany: async () => [] };
  const service = load('src/lib/billing.ts', {
    '@/lib/prisma': { prisma: {
      patient: { findMany: async () => [{ id: 'patient', fullName: 'Synthetic', clinicId: 'clinic' }] },
      invoice: { findMany: async () => [invoice] }, treatmentService: empty,
      receipt: { findMany: async () => [{ id: 'receipt', receiptNo: 'REC', patientId: 'patient', clinicId: 'clinic',
        patient: invoice.patient, amount: 100000, allocatedAmount: 0, unallocatedAmount: 100000,
        method: 'cash', receivedAt: date }] },
      payment: { findMany: async () => [
        { id: 'payment', invoice, amount: 100000, method: 'cash', reference: 'REC', paidAt: date },
        { id: 'reversal', invoice, amount: -100000, method: 'void_reversal', reference: 'INV', paidAt: date },
      ] }, patientCreditBalance: { findMany: async () => [{ patientId: 'patient', clinicId: 'clinic', amount: 100000 }] },
      notification: empty, paymentPlan: empty,
    } },
    '@/lib/data': {}, '@/lib/patient-access': {},
    '@/lib/tenant-scope': { accessibleClinicIds: () => ['clinic'] },
    '@/lib/permissions': { hasAnyRole: () => true },
    '@/lib/runtime-guards': { assertDemoFallbackAllowed(error) { throw error; } },
  });
  const workspace = await service.getBillingWorkspace({ organizationId: 'org' });
  assert.equal(workspace.receipts.length, 1);
  assert.equal(workspace.statementLines.length, 1);
  assert.equal(workspace.statementLines[0].credit, 100000);
  assert.equal(workspace.statementLines[0].balanceAfter, -100000);
  assert.equal(workspace.invoices[0].refundRequestKey, 'invoice:2');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./audit-source-loader.cjs');

// Deliberately a different UTC date: the reporting day must be November 13 in Viet Nam.
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-12T18:30:00Z'])); }
}
const permissions = load('src/lib/permissions.ts');
const data = load('src/lib/data.ts');
const owner = {
  organizationId: 'org', userId: 'owner', fullName: 'Synthetic owner', role: 'OWNER', roles: ['OWNER'],
  roleAssignments: [{ organizationId: 'org', clinicId: null, role: 'OWNER' }],
  activeClinicId: null, clinicIds: ['a1', 'a2', 'b', 'empty'],
  clinics: ['a1', 'a2', 'b', 'empty'].map(id => ({ id, name: id, city: 'Synthetic' })),
};

function fixture() {
  const clinic = (id, chainId, organizationId = 'org') => ({ id, chainId, organizationId,
    name: id, city: 'Synthetic', chain: chainId ? { name: chainId } : null });
  const clinics = [clinic('a1', 'one'), clinic('a2', 'one'), clinic('b', 'two'), clinic('empty', null),
    clinic('hidden', 'one'), clinic('foreign', 'one', 'other-org')];
  let serial = 0;
  const invoice = (clinicId, amount, status = 'OPEN', createdAt = '2026-11-13T12:00:00+07:00', paidAmount = 0, organizationId = 'org') => ({
    id: `I${++serial}`, clinicId, organizationId, amount, status, paidAmount,
    createdAt: new Date(createdAt), dueDate: new Date('2026-11-01T00:00:00+07:00'), patient: { organizationId, leadSource: 'Synthetic' },
  });
  const invoices = [
    invoice('a1', 100000, 'PARTIAL', '2026-11-12T12:00:00+07:00', 70000),
    invoice('a1', 50000, 'DRAFT'), invoice('a1', 10000, 'OPEN', '2026-11-01T00:00:00+07:00'),
    invoice('a1', 20000, 'PAID', '2026-11-13T23:59:59+07:00', 20000), invoice('a1', 999000, 'VOID'),
    invoice('a1', 40000, 'OPEN', '2026-10-31T23:59:59.999+07:00'),
    invoice('a1', 80000, 'OPEN', '2026-11-14T00:00:00+07:00'),
    invoice('a2', 200000, 'PAID', undefined, 200000), invoice('b', 300000),
    invoice('hidden', 9000000), invoice('foreign', 8000000, 'OPEN', undefined, 0, 'other-org'),
  ];
  const receipt = (clinicId, amount, method = 'cash', receivedAt = '2026-11-13T12:00:00+07:00', organizationId = 'org') => ({
    clinicId, organizationId, amount, method, allocatedAmount: 0, unallocatedAmount: amount,
    receivedAt: new Date(receivedAt), patient: { leadSource: 'Synthetic' },
  });
  const receipts = [receipt('a1', 100000), receipt('a1', 20000, 'card'), receipt('a2', 200000, 'bank_transfer'),
    receipt('b', 50000), // An uninvoiced deposit is collection, not production.
    receipt('a1', 70000, 'credit_balance'), receipt('a1', 5000, 'cash', '2026-11-12T12:00:00+07:00'),
    receipt('hidden', 9000000), receipt('foreign', 8000000, 'cash', undefined, 'other-org')];
  const payments = [{ invoiceId: invoices[0].id, amount: 100000, method: 'cash' },
    { invoiceId: invoices[0].id, amount: -30000, method: 'refund:cash' }];
  const queries = [];
  function matches(row, where = {}) {
    return (!where.organizationId || row.organizationId === where.organizationId) &&
      (!where.id?.in || where.id.in.includes(row.id)) &&
      (!where.clinicId?.in || where.clinicId.in.includes(row.clinicId)) &&
      (!where.patient?.organizationId || row.patient.organizationId === where.patient.organizationId) &&
      (!where.method?.not || row.method !== where.method.not) &&
      (!where.receivedAt || (row.receivedAt >= where.receivedAt.gte && row.receivedAt <= where.receivedAt.lte));
  }
  function project(row, select) {
    if (row == null || !select) return row;
    return Object.fromEntries(Object.entries(select).map(([key, value]) =>
      [key, value === true ? row[key] : project(row[key], value.select)]));
  }
  function model(name, rows = []) {
    return { fields: { minimumStock: 'minimumStock' }, count: async () => 0,
      findMany: async args => {
        queries.push({ model: name, ...args });
        return rows.filter(row => matches(row, args.where)).map(row => project(row, args.select));
      } };
  }
  // Only read APIs exist. Real Prisma, configuration and ledger mutations are never loaded.
  const prisma = Object.fromEntries(['chair', 'appointment', 'patient', 'inventoryItem', 'notification', 'workItem',
    'crmActivity', 'attendanceLog', 'user', 'invoiceItem', 'crmLead', 'patientFile', 'communityPost',
    'sourceCommissionPolicy', 'sourceCommissionAccrual'].map(name => [name, model(name)]));
  Object.assign(prisma, { clinic: model('clinic', clinics), invoice: model('invoice', invoices), receipt: model('receipt', receipts) });
  const mocks = { '@/lib/prisma': { prisma }, '@/lib/runtime-guards': { assertDemoFallbackAllowed(error) { throw error; } } };
  return { clinics, invoice, receipt, invoices, receipts, payments, queries,
    dashboard: load('src/lib/dashboard.ts', mocks, { Date: Clock }).getDashboardWorkspace,
    reports: load('src/lib/reports.ts', mocks, { Date: Clock }).getReportsWorkspace };
}

const production = workspace => workspace.clinicSummaries.reduce((sum, clinic) => sum + clinic.production, 0);
const summary = (workspace, id) => workspace.clinicSummaries.find(clinic => clinic.clinicId === id);

test('shared MTD period rolls over at UTC+7 midnight, including the year boundary', () => {
  const { resolveReportPeriod } = load('src/domains/revenue/reporting.ts');
  const before = resolveReportPeriod({}, new Date('2026-12-31T16:59:59Z'));
  assert.equal(before.from, '2026-12-01'); assert.equal(before.to, '2026-12-31');
  const after = resolveReportPeriod({}, new Date('2026-12-31T17:00:00Z'));
  assert.equal(after.from, '2027-01-01'); assert.equal(after.to, '2027-01-01');
  assert.equal(after.start.toISOString(), '2026-12-31T17:00:00.000Z');
  assert.equal(after.end.toISOString(), '2027-01-01T16:59:59.999Z');
});

test('database Dashboard exposes nonzero UTC+7 MTD production equal to Reports and preserves historical receivables', async () => {
  const f = fixture();
  const dash = await f.dashboard(owner), report = await f.reports(owner);
  assert.equal(dash.source, 'database'); assert.equal(dash.message, null);
  assert.equal(report.filters.from, '2026-11-01'); assert.equal(report.filters.to, '2026-11-13');
  assert.equal(production(dash), 680000);
  assert.equal(summary(dash, 'a1').production, 180000, 'prior-day, month boundary, DRAFT and paid invoices count; VOID and out-of-period do not');
  assert.equal(summary(dash, 'empty').production, 0);
  for (const clinic of report.clinicReports) assert.equal(summary(dash, clinic.clinicId).production, clinic.production);
  assert.equal(dash.metrics.find(metric => metric.label === 'Công nợ mở').value, data.formatVnd(510000));
  assert.equal(report.summary.openBalance, 510000, 'prior-month and future invoices remain in the receivables read');
  const query = f.queries.find(query => query.model === 'invoice');
  assert.equal(query.select.clinicId, true); assert.equal(query.select.createdAt, true);
  assert.equal(query.where.createdAt, undefined); assert.equal(query.where.status, undefined);
  assert.equal(query.take, undefined, 'aggregate must not use a capped preview');
});

test('supplied independent QA scenario has 620k active-owner production, 150k gross cash and 2.05m receivables', async () => {
  // Synthetic source-loader counterpart only; no private fixture metadata or database access.
  const f = fixture();
  f.clinics.find(clinic => clinic.id === 'hidden').active = false;
  f.invoices.splice(0, f.invoices.length,
    f.invoice('a1', 120000, 'OPEN', '2026-11-12T12:00:00+07:00'),
    f.invoice('a1', 100000, 'PARTIAL', undefined, 70000), f.invoice('a1', 30000, 'DRAFT'),
    f.invoice('a2', 70000), f.invoice('b', 300000), f.invoice('a1', 900000, 'VOID'),
    f.invoice('a1', 700000, 'OPEN', '2026-10-15T12:00:00+07:00'),
    f.invoice('a1', 800000, 'OPEN', '2026-12-15T12:00:00+07:00'),
    f.invoice('hidden', 500000), f.invoice('foreign', 900000, 'OPEN', undefined, 0, 'other-org'));
  f.receipts.splice(0, f.receipts.length, f.receipt('a1', 100000), f.receipt('a1', 50000));
  const refunded = f.invoices.find(invoice => invoice.status === 'PARTIAL');
  f.payments.splice(0, f.payments.length,
    { invoiceId: refunded.id, amount: 100000, method: 'cash' },
    { invoiceId: refunded.id, amount: -30000, method: 'refund:cash' });

  // A normalized owner session contains active clinics only; auth owns that normalization.
  const dash = await f.dashboard(owner), report = await f.reports(owner);
  assert.equal(production(dash), 620000); assert.equal(report.summary.production, 620000);
  assert.equal(summary(dash, 'a1').production, 250000);
  assert.equal(summary(dash, 'a1').collectedToday, 150000);
  assert.equal(dash.metrics.find(metric => metric.label === 'Đã thu hôm nay').value, data.formatVnd(150000));
  assert.equal(report.summary.collection, 150000);
  assert.equal(refunded.paidAmount, 70000);
  assert.equal(f.payments.reduce((sum, payment) => sum + payment.amount, 0), 70000);
  assert.equal(dash.metrics.find(metric => metric.label === 'Công nợ mở').value, data.formatVnd(2050000));
  assert.equal(report.summary.openBalance, 2050000);
  assert.equal(summary(dash, 'hidden'), undefined); assert.equal(summary(dash, 'foreign'), undefined);

  const render = suiteHarness(dash); let model = render();
  for (const [chain, expected] of [['one', 320000], ['two', 300000], ['all', 620000]]) {
    model.setChainScopeId(chain); model = render(); assert.equal(model.production, expected);
  }
  const manager = { ...owner, role: 'CLINIC_MANAGER', roles: ['CLINIC_MANAGER'], activeClinicId: 'a1',
    roleAssignments: [{ organizationId: 'org', clinicId: 'a1', role: 'CLINIC_MANAGER' }] };
  assert.equal(production(await f.dashboard(manager)), 250000);
  assert.equal((await f.reports(manager)).summary.production, 250000);
});

test('visible collections exclude credit applications and remain gross receipts after refunds', async () => {
  const f = fixture();
  assert.equal(f.payments.reduce((sum, payment) => sum + payment.amount, 0), f.invoices[0].paidAmount);
  const dash = await f.dashboard(owner), report = await f.reports(owner);
  assert.equal(summary(dash, 'a1').collectedToday, 120000);
  assert.equal(dash.metrics.find(metric => metric.label === 'Đã thu hôm nay').value, data.formatVnd(370000));
  assert.equal(dash.metrics.find(metric => metric.label === 'Đã thu hôm nay').detail, '4 phiếu thu');
  assert.equal(report.summary.collection, 375000, 'Reports has MTD rather than daily gross receipts');
  const dayReport = await f.reports(owner, { from: '2026-11-13', to: '2026-11-13' });
  assert.equal(dayReport.summary.collection, 370000);
  const invoiceAmount = f.invoices[0].amount;
  f.payments.push({ invoiceId: f.invoices[0].id, amount: -20000, method: 'refund:bank_transfer' });
  f.invoices[0].paidAmount = 50000;
  const after = await f.dashboard(owner);
  assert.equal(f.invoices[0].amount, invoiceAmount);
  assert.equal(production(after), production(dash));
  assert.equal(summary(after, 'a1').collectedToday, 120000, 'negative Payments do not rewrite gross Receipts');
});

test('Reports retains valid custom/reversed ranges and invalid-input fallback', async () => {
  const f = fixture();
  const day = await f.reports(owner, { from: '2026-11-13', to: '2026-11-13' });
  assert.equal(day.summary.production, 570000);
  const reversed = await f.reports(owner, { from: '2026-11-13', to: '2026-11-12' });
  assert.equal(reversed.filters.from, '2026-11-12'); assert.equal(reversed.filters.to, '2026-11-13');
  assert.equal(reversed.summary.production, 670000);
  for (const value of ['not-a-date', '2026-99-99', '2026-02-31', '2026-02-29']) {
    const invalid = await f.reports(owner, { from: value, to: value });
    assert.equal(invalid.filters.from, '2026-11-01'); assert.equal(invalid.filters.to, '2026-11-13');
    assert.equal(invalid.summary.production, 680000);
  }
});

test('calendar validation rejects normalized dates, accepts leap days and preserves per-input fallback', async () => {
  const { resolveReportPeriod } = load('src/domains/revenue/reporting.ts');
  for (const invalid of ['2026-02-31', '2026-02-29', '2025-02-29', '2026-04-31']) {
    const period = resolveReportPeriod({ from: invalid, to: invalid }, new Clock());
    assert.equal(period.from, '2026-11-01', invalid); assert.equal(period.to, '2026-11-13', invalid);
  }
  const badStart = resolveReportPeriod({ from: '2026-02-31', to: '2026-11-12' }, new Clock());
  assert.equal(badStart.from, '2026-11-01'); assert.equal(badStart.to, '2026-11-12');
  const badEnd = resolveReportPeriod({ from: '2026-11-12', to: '2026-02-29' }, new Clock());
  assert.equal(badEnd.from, '2026-11-12'); assert.equal(badEnd.to, '2026-11-13');
  const leap = resolveReportPeriod({ from: '2024-02-29', to: '2024-02-29' }, new Clock());
  assert.equal(leap.from, '2024-02-29'); assert.equal(leap.to, '2024-02-29');
  assert.equal(leap.start.toISOString(), '2024-02-28T17:00:00.000Z');
  assert.equal(leap.end.toISOString(), '2024-02-29T16:59:59.999Z');
  const forward = resolveReportPeriod({ from: '2024-02-28', to: '2024-03-01' }, new Clock());
  const reversed = resolveReportPeriod({ from: '2024-03-01', to: '2024-02-28' }, new Clock());
  assert.equal(forward.from, '2024-02-28'); assert.equal(forward.to, '2024-03-01');
  assert.equal(reversed.start.getTime(), forward.start.getTime());
  assert.equal(reversed.end.getTime(), forward.end.getTime());
  const f = fixture();
  f.invoices.push(f.invoice('a1', 123000, 'OPEN', '2024-02-29T23:59:59.999+07:00'));
  assert.equal((await f.reports(owner, { from: '2024-02-29', to: '2024-02-29' })).summary.production, 123000);
});

test('Dashboard and Reports include final-millisecond invoices/cash and exclude next-day midnight', async () => {
  const f = fixture();
  const last = f.invoices.find(invoice => invoice.amount === 20000);
  last.createdAt = new Date('2026-11-13T23:59:59.999+07:00');
  f.invoices.push(f.invoice('a1', 7000, 'OPEN', '2026-11-13T23:59:59.001+07:00'));
  f.receipts.find(receipt => receipt.amount === 20000).receivedAt = last.createdAt;
  f.receipts.push(f.receipt('a1', 7000, 'cash', '2026-11-13T23:59:59.001+07:00'),
    f.receipt('a1', 123000, 'cash', '2026-11-14T00:00:00+07:00'),
    f.receipt('a1', 90000, 'credit_balance', '2026-11-13T23:59:59.999+07:00'));
  // The fixture already has an 80k invoice at next-day midnight; it must remain excluded.
  const dash = await f.dashboard(owner), report = await f.reports(owner);
  const dayReport = await f.reports(owner, { from: '2026-11-13', to: '2026-11-13' });
  assert.equal(production(dash), 687000); assert.equal(report.summary.production, 687000);
  assert.equal(dayReport.summary.production, 577000);
  assert.equal(summary(dash, 'a1').production, 187000);
  assert.equal(summary(dash, 'a1').collectedToday, 127000);
  assert.equal(dash.metrics.find(metric => metric.label === 'Đã thu hôm nay').value, data.formatVnd(377000));
  assert.equal(dayReport.summary.collection, 377000); assert.equal(report.summary.collection, 382000);
});

test('canonical clinic and tenant scope applies before aggregation, including empty scopes', async () => {
  const f = fixture();
  const manager = { ...owner, role: 'CLINIC_MANAGER', roles: ['CLINIC_MANAGER'], activeClinicId: 'a1',
    roleAssignments: [{ organizationId: 'org', clinicId: 'a1', role: 'CLINIC_MANAGER' }] };
  const dash = await f.dashboard(manager);
  assert.deepEqual(Array.from(dash.clinicSummaries, clinic => clinic.clinicId), ['a1']);
  assert.equal(production(dash), 180000);
  assert.equal((await f.reports(manager, { clinicId: 'b' })).summary.production, 180000);
  const area = { ...owner, role: 'AREA_MANAGER', roles: ['AREA_MANAGER'], clinicIds: ['a1', 'a2'],
    roleAssignments: [{ organizationId: 'org', clinicId: null, role: 'AREA_MANAGER' }] };
  assert.equal(production(await f.dashboard(area)), 380000);
  const foreignHint = { ...owner, clinicIds: [...owner.clinicIds, 'foreign'] };
  assert.equal(production(await f.dashboard(foreignHint)), 680000);
  const foreign = { ...owner, organizationId: 'other-org', clinicIds: ['foreign'],
    roleAssignments: [{ organizationId: 'other-org', clinicId: null, role: 'OWNER' }] };
  assert.equal(production(await f.dashboard(foreign)), 8000000);
  const empty = await f.dashboard({ ...owner, clinicIds: [], clinics: [] });
  assert.equal(empty.source, 'database'); assert.equal(empty.clinicSummaries.length, 0); assert.equal(production(empty), 0);
  assert.equal(empty.metrics.find(metric => metric.label === 'Đã thu hôm nay').value, data.formatVnd(0));
  assert.equal((await f.reports({ ...owner, clinicIds: [] })).summary.production, 0);
});

function suiteHarness(dashboardWorkspace, session = owner) {
  const values = []; let index = 0;
  const { useDentalSuiteModel } = load('src/components/suite-model.tsx', {
    react: { useMemo: fn => fn(), useEffect() {}, useLayoutEffect() {}, useState(initial) {
      const slot = index++;
      if (!(slot in values)) values[slot] = initial;
      return [values[slot], value => { values[slot] = value; }];
    } },
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() },
    './suite-shared': { initialLanguage: 'en', uiText: { en: {}, vi: {} }, normalizeSearchText: value => value,
      patientSearchMatches: list => list, moduleAiOutput: () => null, buildModuleAiContext: () => ({}), stringifyAiContext: JSON.stringify },
  });
  return () => { index = 0; return useDentalSuiteModel({ activeView: 'dashboard', dashboardWorkspace, session }); };
}

function dashboardHtml(model, language) {
  const { Dashboard } = load('src/modules/dashboard/Dashboard.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': new Proxy({}, { get: () => () => null }),
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@/app/(app)/dashboard/actions': {}, '@/components/AppLanguage': { useAppLanguage: () => ({ language }) },
    '@/components/WorkspaceNotifications': { NotificationComposer: () => null },
    '@/components/suite-primitives': { EmptyState: () => null, PanelHeader: () => null, StatusPill: () => null },
  });
  return renderToStaticMarkup(React.createElement(Dashboard, model));
}

test('normal Dashboard-only suite model and bilingual metric preserve nonzero totals through chain selection', async () => {
  const dash = await fixture().dashboard(owner);
  const render = suiteHarness(dash);
  let model = render();
  assert.equal(model.patientWorkspace, undefined); assert.equal(model.scheduleWorkspace, undefined); assert.equal(model.reportsWorkspace, undefined);
  assert.equal(model.production, 680000); assert.equal(model.collection, 370000);
  assert.deepEqual(Array.from(model.chainOptions, chain => chain.id), ['one', 'two']);
  for (const [chain, expectedProduction, expectedCash] of [['one', 380000, 320000], ['two', 300000, 50000], ['missing', 0, 0], ['all', 680000, 370000]]) {
    model.setChainScopeId(chain); model = render();
    assert.equal(model.production, expectedProduction); assert.equal(model.collection, expectedCash);
    for (const [language, label] of [['en', 'Production (month to date)'], ['vi', 'Doanh thu từ đầu tháng']]) {
      const html = dashboardHtml(model, language);
      assert.ok(html.includes(`<dt>${label}</dt><dd>${data.formatVnd(expectedProduction)}</dd>`), `${language}: ${chain}`);
    }
  }
  const empty = suiteHarness(await fixture().dashboard({ ...owner, clinicIds: [], clinics: [] }), { ...owner, clinicIds: [], clinics: [] })();
  assert.equal(empty.production, 0); assert.equal(empty.collection, 0);
});

test('Dashboard role access remains assignment-aware without broadening Billing or clinical roles', () => {
  for (const role of ['OWNER', 'AREA_MANAGER', 'CLINIC_MANAGER', 'DENTIST', 'HYGIENIST', 'FRONT_DESK', 'BILLING', 'PATIENT']) {
    assert.equal(permissions.canAccessView(role, 'dashboard'), ['OWNER', 'AREA_MANAGER', 'CLINIC_MANAGER'].includes(role));
  }
  const actor = { ...owner, role: 'CLINIC_MANAGER', activeClinicId: 'b', roleAssignments: [
    { organizationId: 'org', clinicId: 'a1', role: 'CLINIC_MANAGER' },
    { organizationId: 'org', clinicId: 'b', role: 'DENTIST' },
  ] };
  assert.equal(permissions.canAccessView(actor, 'dashboard'), false);
  assert.equal(permissions.canAccessView({ ...actor, activeClinicId: 'a1' }, 'dashboard'), true);
});

test('demo Dashboard supplies the same numeric production contract within the active clinic', async () => {
  const clinics = data.clinics.slice(0, 2);
  const { getDashboardWorkspace } = load('src/lib/dashboard.ts', {
    '@/lib/prisma': { prisma: { clinic: { findMany() { throw new Error('Synthetic unavailable database'); } } } },
    '@/lib/runtime-guards': { assertDemoFallbackAllowed() {} },
  });
  const workspace = await getDashboardWorkspace({ ...owner, role: 'CLINIC_MANAGER', roles: ['CLINIC_MANAGER'],
    clinicIds: clinics.map(clinic => clinic.id), activeClinicId: clinics[1].id, roleAssignments: [
      { organizationId: 'org', clinicId: clinics[1].id, role: 'CLINIC_MANAGER' },
    ] });
  assert.equal(workspace.source, 'demo');
  assert.equal(workspace.clinicSummaries.length, 1);
  assert.equal(workspace.clinicSummaries[0].production, clinics[1].production);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

for (const skew of [-60000, 60000]) test(`outbox reclaim and retry use the database clock with app skew ${skew}ms`, async () => {
  class SkewedDate extends Date { static now() { return Date.now() + skew; } }
  const statements = [];
  const db = { $transaction: operation => operation(db),
    $queryRawUnsafe: async (sql, ...params) => {
      statements.push({ sql, params });
      if (sql.includes('WITH picked')) return [{ id: 'event', organizationId: 'org', topic: 'test', eventType: 'test', attempts: 1 }];
      return [{ id: 'event' }];
    },
    $executeRawUnsafe: async (sql, ...params) => { statements.push({ sql, params }); return 1; } };
  const { dispatchIntegrationOutbox } = load('src/infrastructure/integrations/substrate.ts', {}, {
    Date: SkewedDate, setInterval: () => ({ unref() {} }), clearInterval() {},
  });
  const result = await dispatchIntegrationOutbox(db, async () => { throw new Error('synthetic-provider-failure'); },
    { topic: 'test', staleLockMs: 1000, retryDelayMs: 5000 });
  assert.equal(result.retried, 1); assert.equal(result.lostLease, 0);
  const claim = statements.find(value => value.sql.includes('WITH picked'));
  assert.ok(claim.sql.includes("clock_timestamp() AT TIME ZONE 'UTC'") && claim.sql.includes('$3::double precision'));
  assert.equal(claim.params[2], 1000);
  const retry = statements.find(value => value.sql.includes('"availableAt" = CASE'));
  assert.ok(retry.sql.includes("clock_timestamp() AT TIME ZONE 'UTC'") && retry.sql.includes('$4::double precision'));
  assert.equal(retry.params[3], 5000);
});

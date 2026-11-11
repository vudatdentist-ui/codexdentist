const test = require('node:test'), assert = require('node:assert/strict');
const { inputGuard, claimProjection, SMTP } = require('./owned-signing-smtp-client.cjs');
const fixture = () => ({ action: 'review', password: 'a'.repeat(64), principals: [
  { purpose: 'main', userId: 3, teamId: 3, email: 'signing-operator@codexdentist.com' },
  { purpose: 'qa', userId: 4, teamId: 4, email: 'signing-qa@codexdentist.com' }] });
test('dedicated fixed principals deny cross-owner substitutions, arbitrary admin, malformed secrets and replay actions', () => {
  assert.deepEqual(inputGuard(fixture()), fixture());
  for (const mutate of [value => value.action = 'send-email', value => value.password = 'short',
    value => value.principals[1].purpose = 'main', value => value.principals[0].email = 'owner@example.test',
    value => value.principals[1].userId = 3, value => value.principals[1].teamId = 3,
    value => value.principals[0].userId = true, value => value.principals.pop()]) {
    const value = fixture(); mutate(value); assert.throws(() => inputGuard(value));
  }
});
test('claim projection preserves all quotas/flags instead of applying defaults or enabling paid flags', () => {
  const claim = { teamCount: 2, memberCount: 7, envelopeItemCount: 3, recipientCount: 4, flags: { enabled: false },
    documentRateLimits: { perMinute: 5 }, documentQuota: 50, emailRateLimits: { perHour: 7 }, emailQuota: 60,
    apiRateLimits: { perMinute: 3 }, apiQuota: 70, emailTransportId: null, id: 'private', updatedAt: new Date() };
  const projected = claimProjection(claim);
  assert.equal(projected.flags, claim.flags); assert.equal(projected.documentQuota, 50);
  assert.equal(projected.emailTransportId, null); assert.equal('id' in projected, false);
  assert.equal(Object.keys(projected).length, 12);
  const partial = { ...claim }; delete partial.emailRateLimits; assert.throws(() => claimProjection(partial));
});
test('owned transport is fixed implicit TLS without credentials, TLS bypass or external hostname', () => {
  assert.deepEqual(SMTP, { type: 'SMTP_AUTH', host: 'codexdentist-mail-smtp', port: 2465, secure: true, ignoreTLS: false });
  assert.equal(Object.isFrozen(SMTP), true);
});

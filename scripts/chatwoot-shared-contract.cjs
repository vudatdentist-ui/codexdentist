// Pre-merge: CHATWOOT_SHARED_ROOT can point to the parent's shared implementation.
// After composition it defaults to this checkout. Read-only dependency loading.
const path = require('node:path');
const assert = require('node:assert/strict');
const { startChatwootContractDriver } = require('./chatwoot-contract-driver.cjs');
const { fixture } = require('./chatwoot-test-fixture.cjs');
async function main() {
  const driver = await startChatwootContractDriver();
  try {
    const root = process.env.CHATWOOT_SHARED_ROOT ?? path.resolve(__dirname, '..');
    const { load } = require(path.join(root, 'scripts/audit-source-loader.cjs'));
    const shared = load('src/integrations/optional-http.ts', {}, { Response, Headers, fetch, process: { env: {
      NODE_ENV: 'test', OPTIONAL_PROVIDER_ALLOWED_ORIGINS: driver.origin,
    } } });
    for (const loss of [null, 'loseContact', 'loseConversation']) {
      if (loss) driver.state[loss] = true;
      const f = fixture({ provider: driver, secrets: { baseUrl: driver.origin }, optionalProviderFetch: shared.optionalProviderFetch });
      const beforeContacts = driver.state.contacts.length, beforeConversations = driver.state.conversations.length;
      if (loss) { await assert.rejects(f.ensure()); await f.recover(); }
      await f.ensure(); assert.equal((await f.get()).state, 'SAVED');
      assert.equal(driver.state.contacts.length, beforeContacts + 1); assert.equal(driver.state.conversations.length, beforeConversations + 1);
    }
    const settings = { baseUrl: 'http://127.0.0.1:1', apiToken: 'synthetic-chatwoot-token', accountId: '1', inboxId: '2' };
    const f = fixture({ secrets: settings, optionalProviderFetch: shared.optionalProviderFetch });
    await assert.rejects(f.ensure(), /chatwoot-provider-unavailable/); assert.equal(f.refs().length, 0);
    console.log('Chatwoot shared HTTP contract passed: actual helper + adapter + route command, allowlisted loopback, contact/conversation lost-response recovery, no duplicate or unapproved-origin I/O.');
  } finally { await driver.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

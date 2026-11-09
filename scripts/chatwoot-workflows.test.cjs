const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
const { startChatwootContractDriver } = require('./chatwoot-contract-driver.cjs');

const { fixture } = require('./chatwoot-test-fixture.cjs');

function count(f, endpoint) { return f.provider.calls.filter(call => call.method === 'POST' && call.path.endsWith(endpoint)).length; }

test('verifies actual account identity and a safe API inbox, rejecting unsafe settings/provider identity', async () => {
  const f = fixture(); assert.equal((await f.adapter.verifyChatwootConnection(f.secrets)).identity, 'https://chatwoot.example.test/accounts/1');
  f.provider.wrongAccount = true; await assert.rejects(f.adapter.verifyChatwootConnection(f.secrets), /chatwoot-account-mismatch/);
  f.provider.wrongAccount = false; f.provider.unsafeInbox = true; await assert.rejects(f.adapter.verifyChatwootConnection(f.secrets), /chatwoot-inbox-unsafe/);
  for (const baseUrl of ['https://user:pass@example.test', 'https://example.test/base', 'https://example.test?key=x', 'https://example.test#x', 'file:///'])
    assert.throws(() => f.adapter.chatwootSettings({ ...f.secrets, baseUrl }), /chatwoot-settings-invalid/);
});
test('real command creates one opaque contact/conversation; replay/list minimize data and audit atomically', async () => {
  const f = fixture(); const first = await f.ensure(); assert.equal(first.state, 'SAVED');
  assert.equal(first.contactId, '10'); assert.equal(first.conversations[0].url, 'https://chatwoot.example.test/app/accounts/1/conversations/20');
  await f.ensure(); await f.get();
  assert.equal(count(f, '/contacts'), 1); assert.equal(count(f, '/conversations'), 1); assert.equal(f.refs().length, 1);
  assert.equal(f.audit().length, 4);
  assert.doesNotMatch(JSON.stringify({ first, refs: f.refs(), audit: f.audit(), calls: f.provider.calls }), /synthetic-private|synthetic-chatwoot-token/);
});

test('private API credentials stay on the API origin while staff links use the configured HTTPS origin', async () => {
  const f=fixture({secrets:{baseUrl:'http://codexdentist-chatwoot:3000',publicBaseUrl:'https://chat.example.test'}});
  const view=await f.ensure();
  assert.equal(view.conversations[0].url,'https://chat.example.test/app/accounts/1/conversations/20');
  // The fixture asserts the actual origin on every provider HTTP request.
  assert.ok(f.provider.calls.length>0);
  for(const publicBaseUrl of ['http://public.example.test','https://user:key@chat.example.test','https://chat.example.test/path','https://chat.example.test?key=secret'])
    assert.throws(()=>f.adapter.chatwootSettings({...f.secrets,publicBaseUrl}),/chatwoot-settings-invalid/);
});
test('concurrent commands reserve only one contact and conversation', async () => {
  const f = fixture(); await Promise.all([f.ensure(), f.ensure(), f.ensure()]);
  assert.equal((await f.get()).state, 'SAVED'); assert.equal(count(f, '/contacts'), 1); assert.equal(count(f, '/conversations'), 1);
});
for (const stage of ['Contact', 'Conversation']) test(`lost ${stage.toLowerCase()} response recovers by exact stable identifier without second create`, async () => {
  const f = fixture(); f.provider[`lose${stage}`] = true;
  await assert.rejects(f.ensure(), /chatwoot-provider-unavailable/); assert.equal((await f.get()).state, 'UNKNOWN');
  await f.recover(); await f.ensure();
  assert.equal((await f.get()).state, 'SAVED'); assert.equal(count(f, '/contacts'), 1); assert.equal(count(f, '/conversations'), 1);
});
test('unseen contact request remains unknown across repeated retries; never blindly reposts', async () => {
  const f = fixture(); f.provider.before = async ({ path }) => { if (path.endsWith('/contacts')) throw new Error('Before write'); };
  await assert.rejects(f.ensure()); f.provider.before = async () => {};
  await f.ensure(); await f.recover(); assert.equal((await f.get()).state, 'UNKNOWN'); assert.equal(count(f, '/contacts'), 1); assert.equal(count(f, '/conversations'), 0);
});
test('explicit manual linking requires exact opaque identifier and scopes conversation to linked contact/inbox', async () => {
  const f = fixture(); f.provider.loseContact = true; await assert.rejects(f.ensure());
  const opaque = f.refs()[0].externalId;
  f.provider.contacts[0].identifier = 'another-opaque-id';
  await assert.rejects(f.app.manageChatwootPatient(f.session, { patientId: 'patient', action: 'link', contactId: '10' }), /chatwoot-contact-mismatch/);
  f.provider.contacts[0].identifier = opaque;
  f.provider.conversations.push({ id: 99, inbox_id: 2, account_id: 1, status: 'pending', meta: { sender: { id: 10 } }, additional_attributes: {} });
  const result = await f.app.manageChatwootPatient(f.session, { patientId: 'patient', action: 'link', contactId: '10', conversationId: '99' });
  assert.equal(result.state, 'SAVED'); assert.equal(f.refs()[0].metadata.conversationId, '99'); assert.equal(count(f, '/conversations'), 0);
});
test('prepare supports explicit existing-contact linking before any create; no name/email matching or export', async () => {
  const f = fixture();
  const prepared = await f.app.manageChatwootPatient(f.session, { patientId: 'patient', action: 'prepare' });
  assert.equal(prepared.state, 'EMPTY'); assert.match(prepared.opaqueIdentifier, /^cdcw_/);
  assert.equal(count(f, '/contacts'), 0); assert.equal(count(f, '/conversations'), 0);
  // Staff explicitly sets this identifier on the known contact in Chatwoot.
  f.provider.contacts.push({ id: 123, identifier: prepared.opaqueIdentifier, contact_inboxes: [{ source_id: 'opaque-source', inbox: { id: 2 } }] });
  f.provider.conversations.push({ id: 456, inbox_id: 2, account_id: 1, status: 'resolved', meta: { sender: { id: 123 } }, additional_attributes: {} });
  const linked = await f.app.manageChatwootPatient(f.session, { patientId: 'patient', action: 'link', contactId: '123', conversationId: '456' });
  assert.equal(linked.state, 'SAVED'); assert.equal(linked.contactId, '123'); assert.equal(linked.conversations[0].id, '456');
  await f.ensure(); assert.equal(count(f, '/contacts'), 0); assert.equal(count(f, '/conversations'), 0);
});
for (const variant of ['organization', 'clinic', 'role', 'demo', 'patient', 'assignment']) test(`${variant} denial prevents external I/O and reference writes`, async () => {
  const f = fixture();
  if (variant === 'organization') f.session.organizationId = 'other';
  if (variant === 'clinic') f.session.clinicIds = ['other'];
  if (variant === 'role') { f.session.role = 'DENTIST'; f.session.roles = ['DENTIST']; }
  if (variant === 'demo') f.session.isDemo = true;
  if (variant === 'patient') f.patient.id = 'other';
  if (variant === 'assignment') f.session.roleAssignments = [{ role: 'OWNER', organizationId: 'org', clinicId: 'other' }];
  await assert.rejects(f.ensure()); assert.equal(f.provider.calls.length, 0); assert.equal(f.refs().length, 0);
});
test('front desk can operate; disabled/demo reads are explicit states with zero provider I/O', async () => {
  const f = fixture({ session: { role: 'FRONT_DESK', roles: ['FRONT_DESK'] } }); assert.equal((await f.ensure()).state, 'SAVED');
  const disabled = fixture(); disabled.controls.configured = false; assert.equal((await disabled.get()).state, 'DISABLED');
  await assert.rejects(disabled.ensure()); assert.equal(disabled.provider.calls.length, 0);
  const demo = fixture({ session: { isDemo: true } }); assert.equal((await demo.get()).state, 'DISABLED'); assert.equal(demo.provider.calls.length, 0);
});
test('clinic move, connection replacement, source/identifier changes and duplicate ownership fail closed', async () => {
  const f = fixture(); await f.ensure(); const posts = count(f, '/contacts') + count(f, '/conversations');
  f.secrets.accountId = '8'; await assert.rejects(f.get(), /chatwoot-binding-conflict/); f.secrets.accountId = '1';
  f.refs()[0].clinicId = 'other'; await assert.rejects(f.get(), /chatwoot-binding-conflict/); f.refs()[0].clinicId = 'clinic';
  f.provider.contacts[0].identifier = 'other'; assert.equal((await f.get()).state, 'UNKNOWN'); await assert.rejects(f.ensure(), /chatwoot-contact-mismatch/);
  assert.equal(count(f, '/contacts') + count(f, '/conversations'), posts);
});
test('failed initial audit rolls back reservation; failed final audit recovers without another provider create', async () => {
  const f = fixture(); f.controls.auditFailure = 'patient.chatwoot_requested'; await assert.rejects(f.ensure());
  assert.equal(f.refs().length, 0); assert.equal(count(f, '/contacts'), 0);
  f.controls.auditFailure = 'patient.chatwoot_conversation_linked'; await assert.rejects(f.ensure());
  assert.equal(f.refs()[0].metadata.status, 'CONVERSATION_CREATING'); f.controls.auditFailure = null;
  await f.recover(); assert.equal((await f.get()).state, 'SAVED'); assert.equal(count(f, '/conversations'), 1);
});
test('missing saved conversation and changed contact source are unknown rather than stale success', async () => {
  const f = fixture(); await f.ensure();
  f.provider.conversations.length = 0; assert.equal((await f.get()).state, 'UNKNOWN');
  await f.ensure(); assert.equal(count(f, '/conversations'), 1, 'Saved ownership never authorizes automatic recreation');
  f.provider.contacts[0].contact_inboxes[0].source_id = 'changed-source';
  assert.equal((await f.get()).conversations.length, 0); await assert.rejects(f.ensure(), /chatwoot-binding-conflict/);
});
test('configuration version rotation during provider request fences the old operation', async () => {
  const f = fixture();
  f.provider.before = async ({ path }) => {
    if (path.endsWith('/contacts')) f.connection.metadata = { configurationVersion: 'v2', verifiedVersion: 'v2' };
  };
  await assert.rejects(f.ensure(), /chatwoot-connection-changed/);
  assert.equal(f.refs()[0].metadata.status, 'CONTACT_CREATING'); f.provider.before = async () => {};
  await f.ensure(); assert.equal(count(f, '/contacts'), 1); assert.equal(count(f, '/conversations'), 1);
});
test('connection disable during provider write leaves recoverable ownership and cannot write through stale settings', async () => {
  const f = fixture(); f.provider.before = async ({ path }) => { if (path.endsWith('/contacts')) f.connection.status = 'DISABLED'; };
  await assert.rejects(f.ensure(), /chatwoot-connection-changed/); assert.equal(f.refs()[0].metadata.status, 'CONTACT_CREATING');
  f.connection.status = 'ACTIVE'; f.provider.before = async () => {}; await f.ensure(); assert.equal(count(f, '/contacts'), 1);
});
test('route rejects CSRF, unauthenticated, oversized/extra fields; errors never include provider text and responses are no-store', async () => {
  const f = fixture(); const url = 'https://app.example.test/api/integrations/chatwoot/patient-conversations';
  const request = value => new Request(url, { method: 'POST', body: JSON.stringify(value) });
  f.controls.sameOrigin = false; assert.equal((await f.route.POST(request({ patientId: 'patient', action: 'ensure' }))).status, 403);
  f.controls.sameOrigin = true; f.controls.sessionPresent = false; assert.equal((await f.route.GET(new Request(url))).status, 401);
  f.controls.sessionPresent = true;
  for (const input of [{ patientId: 'patient', action: 'ensure', name: 'Do not export' }, { patientId: 'x'.repeat(3000), action: 'ensure' }, { patientId: 'patient', action: 'send' }])
    assert.equal((await f.route.POST(request(input))).status, 400);
  f.provider.fail = true; const failed = await f.route.POST(request({ patientId: 'patient', action: 'ensure' }));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private|token|Error/); assert.equal(failed.headers.get('cache-control'), 'no-store');
});
test('actual adapter obeys loopback HTTP contract including lost-response recovery and no message endpoint', async t => {
  const driver = await startChatwootContractDriver(); t.after(driver.close);
  const settings = { baseUrl: driver.origin, apiToken: 'synthetic-chatwoot-token', accountId: '1', inboxId: '2' };
  const adapter = load('src/integrations/chatwoot/client.ts', { '@/integrations/optional-http': { optionalProviderFetch: async (url, init) => {
    assert.equal(new URL(url).origin, driver.origin); return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(2000) });
  } } });
  assert.equal((await adapter.verifyChatwootConnection(settings)).identity, `${driver.origin}/accounts/1`);
  const opaque = 'cdcw_12345678-1234-1234-1234-123456789abc';
  driver.state.loseContact = true; await assert.rejects(adapter.createChatwootContact(settings, opaque));
  const linked = await adapter.findChatwootContact(settings, opaque); assert.equal(linked.id, '10');
  driver.state.loseConversation = true; await assert.rejects(adapter.createChatwootConversation(settings, linked, opaque));
  assert.equal((await adapter.listChatwootConversations(settings, linked))[0].operation, opaque);
  assert.equal(driver.state.contacts.length, 1); assert.equal(driver.state.conversations.length, 1);
});
test('safe app links reject credentials, query, fragments, foreign paths and script schemes', () => {
  const { safeChatwootLink } = load('src/features/integrations/chatwoot-workspace.ts');
  assert.equal(safeChatwootLink('https://chatwoot.test/app/accounts/1/conversations/2'), 'https://chatwoot.test/app/accounts/1/conversations/2');
  for (const value of ['javascript:alert(1)', 'https://user:pass@chatwoot.test/app/accounts/1/conversations/2', 'https://chatwoot.test/app/accounts/1/conversations/2?token=x', 'https://chatwoot.test/redirect', '//evil.test', 'https://chatwoot.test/app/accounts/1/conversations/2#x']) assert.equal(safeChatwootLink(value), null);
});

// Synthetic loopback Chatwoot application API. No real credentials or patient data.
const http = require('node:http');
const assert = require('node:assert/strict');
function syntheticChatwoot() {
  const state = { contacts: [], conversations: [], calls: [], fail: null, loseContact: false, loseConversation: false,
    wrongAccount: false, unsafeInbox: false, before: async () => {} };
  async function handle(url, init = {}) {
    const path = new URL(url).pathname, method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer synthetic-chatwoot-token');
    assert.ok(!/messages|search/.test(path), 'Never send messages or search by name/email');
    state.calls.push({ path, method, body });
    await state.before({ path, method, body });
    if (state.fail) throw new Error('Synthetic provider failure containing synthetic-private-text');
    const prefix = '/api/v1/accounts/1';
    if (path === prefix) return { id: state.wrongAccount ? 9 : 1, name: 'Synthetic account' };
    if (path === `${prefix}/inboxes/2`) return { id: 2, channel_type: state.unsafeInbox ? 'Channel::Email' : 'Channel::Api', greeting_enabled: false };
    if (path === `${prefix}/contacts/filter`) {
      assert.deepEqual(Object.keys(body), ['payload']);
      assert.equal(body.payload[0].attribute_key, 'identifier');
      assert.equal(body.payload[0].filter_operator, 'equal_to');
      const found = state.contacts.filter(row => row.identifier === body.payload[0].values[0]);
      return { meta: { count: found.length }, payload: found };
    }
    if (path === `${prefix}/contacts` && method === 'POST') {
      assert.deepEqual(Object.keys(body).sort(), ['identifier', 'inbox_id']);
      assert.equal(body.inbox_id, 2);
      assert.match(body.identifier, /^cdcw_[a-f0-9-]{36}$/);
      assert.ok(!state.contacts.some(row => row.identifier === body.identifier), 'Duplicate contact POST');
      const row = { id: state.contacts.length + 10, identifier: body.identifier, name: 'Synthetic private contact text',
        email: 'synthetic-private@example.test', contact_inboxes: [{ source_id: 'opaque-source', inbox: { id: 2 } }] };
      state.contacts.push(row);
      if (state.loseContact) { state.loseContact = false; throw new Error('Synthetic lost contact response'); }
      return { payload: { contact: row } };
    }
    const contactPath = path.match(/\/contacts\/(\d+)(\/conversations)?$/);
    if (contactPath) {
      const row = state.contacts.find(row => String(row.id) === contactPath[1]);
      if (!row) throw new Error('Synthetic contact not found');
      if (contactPath[2]) return { payload: state.conversations.filter(item => item.meta.sender.id === row.id) };
      return { payload: row };
    }
    if (path === `${prefix}/conversations` && method === 'POST') {
      assert.deepEqual(Object.keys(body).sort(), ['additional_attributes', 'contact_id', 'inbox_id', 'source_id', 'status']);
      assert.equal(body.inbox_id, 2); assert.equal(body.source_id, 'opaque-source');
      assert.deepEqual(Object.keys(body.additional_attributes), ['codexdentist_operation']);
      assert.ok(!state.conversations.some(row => row.additional_attributes.codexdentist_operation === body.additional_attributes.codexdentist_operation), 'Duplicate conversation POST');
      const row = { id: state.conversations.length + 20, inbox_id: 2, account_id: 1, status: 'open',
        meta: { sender: { id: body.contact_id } }, additional_attributes: body.additional_attributes,
        messages: [{ content: 'Synthetic private message that must never leave provider response' }] };
      state.conversations.push(row);
      if (state.loseConversation) { state.loseConversation = false; throw new Error('Synthetic lost conversation response'); }
      return row;
    }
    throw new Error(`Unexpected synthetic endpoint ${path}`);
  }
  return { state, handle };
}
async function startChatwootContractDriver() {
  const driver = syntheticChatwoot();
  const server = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Too large'); }
      const data = await driver.handle(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: body || undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    } catch { req.socket.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { ...driver, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { syntheticChatwoot, startChatwootContractDriver };
if (require.main === module) startChatwootContractDriver().then(driver => {
  console.log(`Synthetic Chatwoot contract driver: ${driver.origin}`);
  process.on('SIGINT', () => driver.close().then(() => process.exit(0)));
});

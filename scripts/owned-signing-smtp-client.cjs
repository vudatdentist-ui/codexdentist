// Private CE configuration only. Never send a message from this operator.
const { requestHeaders, verificationToken } = require('./owned-signing-bootstrap-client.cjs');
const ADMIN_EMAIL = 'signing-admin@codexdentist.com';
const CLAIM_FIELDS = ['teamCount', 'memberCount', 'envelopeItemCount', 'recipientCount', 'flags',
  'documentRateLimits', 'documentQuota', 'emailRateLimits', 'emailQuota', 'apiRateLimits', 'apiQuota', 'emailTransportId'];
const SMTP = Object.freeze({ type: 'SMTP_AUTH', host: 'codexdentist-mail-smtp', port: 2465, secure: true, ignoreTLS: false });

function inputGuard(input) {
  if (!input || !['review', 'create-admin', 'inspect-admin', 'configure', 'inspect'].includes(input.action) ||
      !/^[a-f0-9]{64}$/.test(input.password ?? '') || !Array.isArray(input.principals) || input.principals.length !== 2 ||
      new Set(input.principals.map(row => row.purpose)).size !== 2) throw Error('Exact owned SMTP input required');
  for (const row of input.principals) {
    const expected = { main: 'signing-operator@codexdentist.com', qa: 'signing-qa@codexdentist.com' }[row.purpose];
    if (!expected || row.email !== expected || !Number.isSafeInteger(row.userId) || row.userId < 1 ||
        !Number.isSafeInteger(row.teamId) || row.teamId < 1) throw Error('Separate ordinary provider principals required');
  }
  if (new Set(input.principals.map(row => row.userId)).size !== 2 || new Set(input.principals.map(row => row.teamId)).size !== 2)
    throw Error('Distinct provider principals required');
  return input;
}

function claimProjection(claim) {
  if (!claim || CLAIM_FIELDS.some(key => !(key in claim))) throw Error('Complete provider claims required');
  return Object.fromEntries(CLAIM_FIELDS.map(key => [key, claim[key]]));
}

function same(a, b) { return require('node:util').isDeepStrictEqual(a, b); }

async function run(raw) {
  const input = inputGuard(raw);
  const database = new URL(process.env.NEXT_PRIVATE_DATABASE_URL);
  if (database.hostname !== 'database' || database.pathname !== '/signing' ||
      process.env.NEXT_PUBLIC_WEBAPP_URL !== 'https://sign.codexdentist.com' ||
      process.env.NEXT_PRIVATE_SMTP_HOST !== 'capture' || process.env.NEXT_PRIVATE_SMTP_PORT !== '1025' ||
      process.env.NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS !== 'codexdentist-signing-callback') throw Error('Reviewed private provider stage required');
  const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); const jar = new Map();
  const acknowledged = {}; let step = 'review';
  async function request(path, { method = 'GET', body, capture = false } = {}) {
    const url = (capture ? 'http://capture:8025' : 'http://localhost:3000') + path;
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: requestHeaders(url, capture ? {} : { body, jar }), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!capture) for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0], index = pair.indexOf('='); if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text(); if (text.length > 262144) throw Error('Private provider response too large');
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, data };
  }
  async function mutation(name, json) {
    const reply = await request('/api/trpc/' + name, { method: 'POST', body: { json } });
    if (reply.status !== 200 || !reply.data?.result?.data) throw Error('Private configuration mutation unacknowledged');
    return reply.data.result.data.json;
  }
  async function signin() {
    const csrf = await request('/api/auth/csrf');
    if (csrf.status !== 200 || typeof csrf.data?.csrfToken !== 'string') throw Error('Private CSRF unavailable');
    const reply = await request('/api/auth/email-password/authorize', { method: 'POST',
      body: { email: ADMIN_EMAIL, password: input.password, csrfToken: csrf.data.csrfToken } });
    if (reply.status !== 201) throw Error('Private admin signin failed');
  }
  async function principals() {
    const result = {};
    for (const row of input.principals) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
      const team = await prisma.team.findUniqueOrThrow({ where: { id: row.teamId }, include: { organisation: { include: { organisationClaim: true } } } });
      if (user.email !== row.email || user.disabled || !user.emailVerified || !same(user.roles, ['USER']) ||
          team.organisation.ownerUserId !== user.id) throw Error('Ordinary isolated main/QA identity differs');
      result[row.purpose] = { organisationId: team.organisationId, claim: team.organisation.organisationClaim };
    }
    if (result.main.organisationId === result.qa.organisationId) throw Error('Distinct main/QA organizations required');
    return result;
  }
  async function admin() {
    const rows = await prisma.user.findMany({ where: { roles: { has: 'ADMIN' } } });
    if (rows.length !== 1 || rows[0].email !== ADMIN_EMAIL || !same(rows[0].roles, ['ADMIN']) ||
        rows[0].disabled || !rows[0].emailVerified || await prisma.apiToken.count({ where: { userId: rows[0].id } }))
      throw Error('One dedicated verified admin without API tokens required');
    return rows[0];
  }
  async function capturedVerification() {
    for (let attempt = 0; attempt < 90; attempt++) {
      const reply = await request('/api/v1/messages', { capture: true });
      if (reply.status !== 200 || !Array.isArray(reply.data?.messages)) throw Error('Private capture unavailable');
      for (const message of reply.data.messages) {
        if (!message.To?.some(row => row.Address === ADMIN_EMAIL)) continue;
        const detail = await request('/api/v1/message/' + encodeURIComponent(message.ID), { capture: true });
        if (detail.status !== 200) throw Error('Captured verification unavailable');
        const token = verificationToken((detail.data.Text ?? '') + '\n' + (detail.data.HTML ?? ''));
        if (token) return token;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('Private verification was not captured');
  }
  try {
    const before = await principals();
    if (input.action === 'review' || input.action === 'create-admin') {
      if (await prisma.user.count({ where: { OR: [{ email: ADMIN_EMAIL }, { roles: { has: 'ADMIN' } }] } }))
        throw Error('Preserve existing provider admin');
      if (await prisma.user.count() !== 4 || await prisma.emailTransport.count() ||
          before.main.claim.emailTransportId !== null || before.qa.claim.emailTransportId !== null)
        throw Error('Preserve unexpected provider installation');
      if (input.action === 'review') return { pass: true, dedicatedAdminAbsent: true };
      if (process.env.NEXT_PUBLIC_DISABLE_SIGNUP !== 'false') throw Error('Explicit private signup window required');
      step = 'signup-admin';
      const signup = await request('/api/auth/email-password/signup', { method: 'POST', body: {
        name: 'Codexdentist private instance administrator', email: ADMIN_EMAIL, password: input.password } });
      if (signup.status !== 201) throw Error('Private admin signup unacknowledged');
      step = 'verify-admin';
      const verify = await request('/api/auth/email-password/verify-email', { method: 'POST', body: { token: await capturedVerification() } });
      if (verify.status !== 200 || verify.data?.state !== 'VERIFIED') throw Error('Private admin verification failed');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
      if (!user.emailVerified || user.disabled || !same(user.roles, ['USER'])) throw Error('Private admin account differs');
      // Official self-host initialization requires a database role grant. No
      // core domain, main/QA roles, billing flags or license checks are changed.
      step = 'grant-instance-admin';
      const granted = await prisma.user.updateMany({ where: { id: user.id, email: ADMIN_EMAIL, roles: { equals: ['USER'] } }, data: { roles: ['ADMIN'] } });
      if (granted.count !== 1) throw Error('Private admin grant changed concurrently');
      acknowledged.adminId = user.id; await admin(); await signin();
    } else {
      if (process.env.NEXT_PUBLIC_DISABLE_SIGNUP !== 'true') throw Error('Signup must be closed');
      acknowledged.adminId = (await admin()).id; await signin();
      if (input.action === 'configure') {
        if (process.env.NODE_EXTRA_CA_CERTS !== '/secrets/provider-trust.cert.pem' || await prisma.emailTransport.count() ||
            before.main.claim.emailTransportId !== null || before.qa.claim.emailTransportId !== null)
          throw Error('Preserve existing mail transport');
        if (await prisma.envelope.count({ where: { teamId: input.principals.find(row => row.purpose === 'main').teamId } }))
          throw Error('Review existing main envelopes and pending jobs before SMTP transition');
        // No email is sent: verify establishes strict TLS and SMTP greeting.
        step = 'smtp-tls-verify';
        const transport = require('nodemailer').createTransport({ ...SMTP, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000 });
        try { await transport.verify(); } finally { transport.close(); }
        step = 'create-transport';
        const created = await mutation('admin.emailTransport.create', { name: 'Codexdentist owned main SMTP',
          fromName: 'Codexdentist', fromAddress: 'no-reply@codexdentist.com', config: SMTP });
        if (typeof created?.id !== 'string' || !/^email_transport_[A-Za-z0-9_-]+$/.test(created.id)) throw Error('Transport creation unacknowledged');
        acknowledged.transportId = created.id;
        // Re-read immediately before updating; retain every existing quota,
        // flag and limit, and explicitly suppress organization notification.
        const current = await principals(); if (!same(current, before)) throw Error('Preserve changed organization claims');
        step = 'bind-main-transport';
        const updated = await mutation('admin.organisation.update', { organisationId: before.main.organisationId,
          data: { claims: { ...claimProjection(before.main.claim), emailTransportId: created.id } }, notifyOrganisation: false });
        if (updated?.isNotificationSent !== false) throw Error('Unexpected organization notification');
        const after = await principals();
        const normalize = value => { const { updatedAt, ...rest } = value; return rest; };
        if (!same(after.qa, before.qa) || !same(normalize(after.main.claim), normalize({ ...before.main.claim, emailTransportId: created.id })))
          throw Error('Organization claim change differs; preserve for review');
      }
      if (['inspect', 'configure'].includes(input.action)) {
        const owned = await principals();
        const transport = await prisma.emailTransport.findMany();
        if (owned.qa.claim.emailTransportId !== null || transport.length !== 1 || owned.main.claim.emailTransportId !== transport[0].id ||
            transport[0].name !== 'Codexdentist owned main SMTP' || transport[0].type !== 'SMTP_AUTH' ||
            transport[0].fromAddress !== 'no-reply@codexdentist.com' || transport[0].fromName !== 'Codexdentist' ||
            typeof transport[0].config !== 'string' || transport[0].config.includes('codexdentist-mail-smtp')) throw Error('Encrypted main-only SMTP transport differs');
        acknowledged.transportId = transport[0].id;
        const listing = await request('/api/trpc/admin.emailTransport.find?input=' + encodeURIComponent(JSON.stringify({ json: { page: 1, perPage: 2 } })));
        const config = listing.data?.result?.data?.json;
        if (listing.status !== 200 || config?.data?.length !== 1 || config.data[0].id !== transport[0].id || !same(config.data[0].config, SMTP))
          throw Error('Provider SMTP config cannot be decrypted or differs');
      }
    }
    return { pass: true, ...acknowledged, ordinaryPrincipalsPreserved: true, globalAndQaMailCaptured: true, externalMailSent: false };
  } catch (error) {
    // Keep an acknowledgement even after a later failure. Never print URLs,
    // credentials, provider payloads or upstream error messages.
    return { pass: false, step, ...acknowledged };
  } finally { await prisma.$disconnect(); }
}

module.exports = { run, inputGuard, claimProjection, SMTP, ADMIN_EMAIL };

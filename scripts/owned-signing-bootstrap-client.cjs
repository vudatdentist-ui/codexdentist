// Runs only inside the private owned CE app. Input/output stay in root custody.
function verificationToken(body) {
  for (const match of body.replaceAll('&amp;', '&').matchAll(/https:\/\/[^\s<>"']+/g)) {
    let url; try { url = new URL(match[0]); } catch { continue; }
    const token = url.pathname.match(/^\/verify-email\/([a-f0-9]{40})$/)?.[1];
    if (url.origin === 'https://sign.codexdentist.com' && !url.search && !url.hash && token) return token;
  }
  return null;
}

function requestHeaders(url, { body, jar, token } = {}) {
  const origin = new URL(url).origin;
  if (origin === 'http://capture:8025') {
    if (body || jar || token) throw Error('Capture reads must not receive app credentials');
    return {};
  }
  if (origin !== 'http://localhost:3000') throw Error('Only private bootstrap endpoints allowed');
  return { origin: 'https://sign.codexdentist.com', ...(body ? { 'content-type': 'application/json' } : {}),
    ...(jar?.size ? { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function run(input) {
const { PrismaClient } = require('@prisma/client');
const database = new URL(process.env.NEXT_PRIVATE_DATABASE_URL);
if (database.hostname !== 'database' || database.pathname !== '/signing' ||
    process.env.NEXT_PUBLIC_WEBAPP_URL !== 'https://sign.codexdentist.com' ||
    process.env.NEXT_PRIVATE_SMTP_HOST !== 'capture' || process.env.NEXT_PRIVATE_SMTP_PORT !== '1025') throw Error('Owned signing identity differs');
const prisma = new PrismaClient();
const completed = [];
let step = 'review';
let lastStatus = null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url, { method = 'GET', body, jar, token } = {}) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: requestHeaders(url, { body, jar, token }), ...(body ? { body: JSON.stringify(body) } : {}) });
  lastStatus = response.status;
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0], split = pair.indexOf('=');
    if (jar && split > 0) jar.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const row = await reader.read(); if (row.done) break;
      size += row.value.length; if (size > 262144) throw Error('Private bootstrap response too large');
      chunks.push(row.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const text = Buffer.concat(chunks).toString('utf8');
  let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data };
}

async function seedOnly() {
  const users = await prisma.user.findMany({ select: { email: true } });
  const expected = ['deleted-account@sign.codexdentist.com', 'serviceaccount@sign.codexdentist.com'].sort();
  const matches = JSON.stringify(users.map(row => row.email).sort()) === JSON.stringify(expected);
  const envelopes = await prisma.envelope.count(), teams = await prisma.team.count();
  if (!matches || envelopes !== 0 || teams !== 2) throw Error('Preserve nonempty signing installation');
  return { seedOnly: true, envelopes, teams };
}

async function verification(email) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const listing = await json('http://capture:8025/api/v1/messages');
    if (listing.status !== 200 || !Array.isArray(listing.data?.messages)) throw Error('Private mail capture unavailable');
    for (const row of listing.data.messages) {
      if (!row.To?.some(to => to.Address === email)) continue;
      const reply = await json(`http://capture:8025/api/v1/message/${encodeURIComponent(row.ID)}`);
      if (reply.status !== 200) throw Error('Private verification message unavailable');
      const token = verificationToken(`${reply.data.Text ?? ''}\n${reply.data.HTML ?? ''}`);
      if (token) return token;
    }
    await delay(500);
  }
  throw Error('Private verification mail was not captured');
}

async function verifyApi(token) {
  const reply = await json('http://localhost:3000/api/v2/envelope?perPage=1', { token });
  if (reply.status !== 200 || !Array.isArray(reply.data?.data)) throw Error('Owned API token unavailable');
}

async function verifyPrincipal(row) {
  const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: row.tokenId },
    select: { userId: true, teamId: true, token: true, algorithm: true } });
  const digest = require('node:crypto').createHash('sha512').update(row.apiToken).digest('hex');
  if (stored.userId !== row.userId || stored.teamId !== row.teamId || stored.algorithm !== 'SHA512' || stored.token !== digest) throw Error('Service credential ownership differs');
}

async function create() {
  if (process.env.NEXT_PUBLIC_DISABLE_SIGNUP !== 'false') throw Error('Explicit private bootstrap stage required');
  await seedOnly();
  let ready = false; const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const response = await json('http://localhost:3000/api/health');
      if (response.status === 200 && response.data?.status === 'ok' && response.data.checks.database.status === 'ok' && response.data.checks.certificate.status === 'ok') { ready = true; break; }
    } catch {}
    await delay(500);
  }
  if (!ready) throw Error('Private bootstrap app unavailable');
  for (const account of input.accounts) {
    const jar = new Map();
    step = `signup-${account.purpose}`;
    const signup = await json('http://localhost:3000/api/auth/email-password/signup', {
      method: 'POST', body: { name: account.name, email: account.email, password: account.password }, jar });
    if (signup.status !== 201) throw Error('Private signup failed');
    step = `verification-${account.purpose}`;
    const token = await verification(account.email);
    const verified = await json('http://localhost:3000/api/auth/email-password/verify-email', { method: 'POST', body: { token }, jar });
    if (verified.status !== 200 || verified.data?.state !== 'VERIFIED') throw Error('Private verification failed');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: account.email }, select: { id: true, emailVerified: true } });
    const teams = await prisma.team.findMany({ where: { organisation: { ownerUserId: user.id } }, select: { id: true } });
    if (!user.emailVerified || teams.length !== 1) throw Error('Private account ownership differs');
    step = `signin-${account.purpose}`;
    const csrf = await json('http://localhost:3000/api/auth/csrf', { jar });
    if (csrf.status !== 200 || typeof csrf.data?.csrfToken !== 'string') throw Error('Private CSRF unavailable');
    const login = await json('http://localhost:3000/api/auth/email-password/authorize', { method: 'POST', jar,
      body: { email: account.email, password: account.password, csrfToken: csrf.data.csrfToken } });
    if (login.status !== 201) throw Error('Private account signin failed');
    step = `api-token-${account.purpose}`;
    const created = await json('http://localhost:3000/api/trpc/apiToken.create', { method: 'POST', jar,
      body: { json: { teamId: teams[0].id, tokenName: `Codexdentist ${account.purpose}`, expirationDate: null } } });
    const data = created.data?.result?.data?.json;
    if (created.status !== 200 || !Number.isInteger(data?.id) || !/^api_[A-Za-z0-9_-]{12,256}$/.test(data?.token)) throw Error('Private token creation failed');
    completed.push({ purpose: account.purpose, userId: user.id, teamId: teams[0].id, tokenId: data.id, apiToken: data.token });
    await verifyPrincipal(completed.at(-1));
    await verifyApi(data.token);
  }
  if (new Set(completed.map(row => row.userId)).size !== 2 || new Set(completed.map(row => row.teamId)).size !== 2) throw Error('Signing service identities must be separate');
  const denied = await json('http://localhost:3000/api/v2/envelope?perPage=1', { token: 'api_deliberately_invalid_bootstrap_token' });
  if (![401, 403].includes(denied.status)) throw Error('Invalid API token accepted');
  return { pass: true, completed, separateTeams: true, externalMailSent: false };
}

  try {
    if (input.action === 'review') console.log(JSON.stringify(await seedOnly()));
    else if (input.action === 'create') console.log(JSON.stringify(await create()));
    else if (input.action === 'inspect') {
      if (process.env.NEXT_PUBLIC_DISABLE_SIGNUP !== 'true') throw Error('Signup must be closed');
      for (const row of input.credentials) {
        await verifyPrincipal(row);
        await verifyApi(row.apiToken);
      }
      console.log(JSON.stringify({ pass: true, separateTeams: true, signupClosed: true, apiAvailable: true }));
    }
    else throw Error('Explicit bootstrap action required');
  } catch (error) {
    // Preserve any acknowledged API keys even if a later operation fails. The
    // root caller seals this result before throwing; it never replays creation.
    const publicFailures = new Set(['Private mail capture unavailable', 'Private verification message unavailable',
      'Private verification mail was not captured', 'Private verification failed', 'Private signup failed',
      'Private CSRF unavailable', 'Private account signin failed', 'Private token creation failed', 'Owned API token unavailable']);
    console.log(JSON.stringify({ pass: false, step, httpStatus: lastStatus, reason: publicFailures.has(error.message) ? error.message : 'Private bootstrap acceptance failed', completed })); process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

module.exports = { run, verificationToken, requestHeaders };

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const MAX_MAIL_BYTES = 64 * 1024;
export class MailFault extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const deny = (code, status) => { throw new MailFault(code, status); };
export const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex');
export function mailSignature(secret, { timestamp, method, pathname, key, bytes }) {
  return createHmac('sha256', secret).update(`${timestamp}\n${method}\n${pathname}\n${key}\n`).update(bytes).digest('hex');
}
export function authenticateMailRequest(secret, request, now = Date.now()) {
  const { timestamp, signature, key, bytes } = request;
  if (typeof secret !== 'string' || secret.length < 32) deny('mail-server-not-configured', 503);
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MAIL_BYTES) deny('mail-request-too-large', 413);
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 ||
      typeof key !== 'string' || !/^(?:notification\/[a-zA-Z0-9_-]{1,128}|readiness)$/.test(key) ||
      typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) deny('mail-request-unauthorized', 401);
  const expected = mailSignature(secret, request);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) deny('mail-request-unauthorized', 401);
}
export function parseMailIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['id', 'organizationId'].every(key => typeof value[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value[key]))) {
    deny('mail-identity-invalid');
  }
  return { id: value.id, organizationId: value.organizationId };
}
export function safeEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\s\u0000-\u001f\u007f<>]/.test(value) ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value)) {
    deny('mail-address-invalid');
  }
  const at = value.lastIndexOf('@');
  return value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
}
export function parseMailEnvelope(value, expectedSender, { testOnly = false, now = Date.now() } = {}) {
  const identity = parseMailIdentity(value);
  const allowed = new Set(['id','organizationId','channel','from','recipient','subject','body','templateKey','expiresAt']);
  if (Object.keys(value).some(key => !allowed.has(key)) || value.channel !== 'EMAIL' || value.from !== expectedSender || typeof value.subject !== 'string' ||
      !value.subject.trim() || value.subject.length > 240 || /[\u0000-\u001f\u007f]/.test(value.subject) ||
      typeof value.body !== 'string' || !value.body.trim() || Buffer.byteLength(value.body) > 48 * 1024 || /\u0000/.test(value.body) ||
      !(value.templateKey === null || typeof value.templateKey === 'string' && /^[A-Z0-9_-]{1,100}$/i.test(value.templateKey)) ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 24 * 60 * 60 * 1000) {
    deny('mail-envelope-invalid');
  }
  const recipient = safeEmailAddress(value.recipient);
  if (testOnly && !/\.(?:test|invalid)$/.test(recipient)) deny('mail-test-recipient-required');
  return { ...identity, channel: 'EMAIL', from: expectedSender, recipient, subject: value.subject,
    body: value.body, templateKey: value.templateKey, expiresAt: value.expiresAt };
}
export function parseMailJson(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) deny('mail-json-invalid');
  try { return JSON.parse(text); } catch { deny('mail-json-invalid'); }
}

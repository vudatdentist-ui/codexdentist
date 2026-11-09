import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MailFault } from './protocol.mjs';

export function openMailStore(filename, encryptionKey) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new MailFault('mail-encryption-key-invalid', 503);
  if (!path.isAbsolute(filename)) throw new MailFault('mail-store-path-invalid', 503);
  if (existsSync(filename)) {
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new MailFault('mail-store-path-invalid', 503);
  }
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, allowExtension: false });
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS mail_jobs (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      sealed_payload BLOB, state TEXT NOT NULL CHECK(state IN ('QUEUED','DISPATCHING','SENT','UNCERTAIN','REJECTED')),
      lease TEXT, receipt_id TEXT, safe_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, dispatch_started_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS mail_meta (name TEXT PRIMARY KEY, value BLOB NOT NULL);`);
  const context = row => Buffer.from(`${row.organization_id}\n${row.id}\n${row.payload_hash}`);
  function seal(row, envelope) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(context(row));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
  }
  function unseal(row) {
    const bytes = Buffer.from(row.sealed_payload ?? []);
    if (bytes.length < 30 || bytes[0] !== 1) throw new MailFault('mail-payload-unavailable', 503);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(1, 13));
    decipher.setAAD(context(row)); decipher.setAuthTag(bytes.subarray(13, 29));
    try { return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8')); }
    catch { throw new MailFault('mail-payload-unavailable', 503); }
  }
  const keyIdentity={id:'key-check',organization_id:'mail-store',payload_hash:'version-1'};
  const probe=db.prepare("SELECT value FROM mail_meta WHERE name='key-check'").get();
  if(probe){
    try{if(unseal({...keyIdentity,sealed_payload:probe.value}).version!==1)throw Error();}
    catch{db.close();throw new MailFault('mail-store-key-mismatch',503);}
  }else{
    db.prepare("INSERT INTO mail_meta(name,value) VALUES('key-check',?)").run(seal(keyIdentity,{version:1}));
  }
  function find(identity) {
    return db.prepare('SELECT * FROM mail_jobs WHERE id=? AND organization_id=?').get(identity.id, identity.organizationId);
  }
  function receipt(row) {
    if (!row) return null;
    return { id: row.id, organizationId: row.organization_id, state: row.state, deliveryId: row.receipt_id ?? null, code: row.safe_code ?? null };
  }
  return {
    reserve(envelope, hash, now = Date.now()) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new MailFault('mail-fingerprint-invalid');
      const row = { id: envelope.id, organization_id: envelope.organizationId, payload_hash: hash };
      const sealed = seal(row, envelope);
      db.prepare(`INSERT INTO mail_jobs(id,organization_id,payload_hash,sealed_payload,state,created_at,updated_at,expires_at)
        VALUES(?,?,?,?,'QUEUED',?,?,?) ON CONFLICT(id) DO NOTHING`).run(row.id, row.organization_id, hash, sealed, now, now, envelope.expiresAt);
      const existing = find(envelope);
      if (!existing || existing.payload_hash !== hash) throw new MailFault('mail-idempotency-conflict', 409);
      return receipt(existing);
    },
    claim(identity, now = Date.now()) {
      const lease = randomUUID();
      const result = db.prepare(`UPDATE mail_jobs SET state='DISPATCHING',lease=?,dispatch_started_at=?,updated_at=?
        WHERE id=? AND organization_id=? AND state='QUEUED' AND expires_at>?`).run(lease, now, now, identity.id, identity.organizationId, now);
      if (result.changes !== 1) return null;
      const row = find(identity);
      try { return { lease, envelope: unseal(row) }; }
      catch (error) {
        db.prepare(`UPDATE mail_jobs SET state='UNCERTAIN',safe_code='mail-payload-unavailable',updated_at=? WHERE id=? AND lease=?`).run(now, identity.id, lease);
        throw error;
      }
    },
    finish(identity, lease, state, safeCode = null, now = Date.now()) {
      if (!['SENT', 'UNCERTAIN', 'REJECTED'].includes(state) ||
          safeCode !== null && !['mail-smtp-rejected', 'mail-smtp-uncertain', 'mail-payload-unavailable'].includes(safeCode)) throw new MailFault('mail-state-invalid');
      const deliveryId = state === 'SENT' ? randomUUID() : null;
      db.prepare(`UPDATE mail_jobs SET state=?,receipt_id=?,safe_code=?,updated_at=?,
        sealed_payload=CASE WHEN ? IN ('SENT','REJECTED') THEN NULL ELSE sealed_payload END
        WHERE id=? AND organization_id=? AND lease=? AND state IN ('DISPATCHING','UNCERTAIN')`).run(
        state, deliveryId, safeCode, now, state, identity.id, identity.organizationId, lease);
      return receipt(find(identity));
    },
    status(identity, now = Date.now()) {
      // A crashed/paused worker is never replayed. Retain its lease so only the
      // same actor may record a late acknowledgement; a new actor cannot send it.
      db.prepare(`UPDATE mail_jobs SET state='UNCERTAIN',safe_code='mail-smtp-uncertain',updated_at=?
        WHERE id=? AND organization_id=? AND state='DISPATCHING' AND dispatch_started_at<?`).run(now, identity.id, identity.organizationId, now - 120_000);
      db.prepare(`UPDATE mail_jobs SET state='REJECTED',sealed_payload=NULL,safe_code='mail-smtp-rejected',updated_at=?
        WHERE id=? AND organization_id=? AND state='QUEUED' AND expires_at<=?`).run(now, identity.id, identity.organizationId, now);
      // Retain only the idempotency tombstone once a credential envelope expires.
      db.prepare(`UPDATE mail_jobs SET sealed_payload=NULL WHERE id=? AND organization_id=? AND expires_at<=?`).run(identity.id, identity.organizationId, now);
      return receipt(find(identity));
    },
    expire(now = Date.now()) {
      db.prepare(`UPDATE mail_jobs SET state='REJECTED',safe_code='mail-smtp-rejected',updated_at=? WHERE state='QUEUED' AND expires_at<=?`).run(now,now);
      db.prepare(`UPDATE mail_jobs SET state='UNCERTAIN',safe_code='mail-smtp-uncertain',updated_at=? WHERE state='DISPATCHING' AND dispatch_started_at<?`).run(now,now-120_000);
      db.prepare(`UPDATE mail_jobs SET sealed_payload=NULL WHERE expires_at<=?`).run(now);
    },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(FULL)'); },
    close() { db.close(); },
  };
}

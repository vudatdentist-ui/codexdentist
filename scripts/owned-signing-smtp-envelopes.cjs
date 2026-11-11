// Native fresh CE only. Both organizations send solely to example.test.
(async () => {
  const fs = require('node:fs'); const credentials = JSON.parse(fs.readFileSync(0, 'utf8'));
  const { PDFDocument } = require('@cantoo/pdf-lib'); const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Synthetic SMTP routing acceptance - no patient data'); const bytes = await pdf.save();
  const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
  try {
    for (const purpose of ['main', 'qa']) {
      const credential = credentials.find(row => row.purpose === purpose);
      const payload = { type: 'DOCUMENT', title: 'Synthetic mail routing ' + purpose, externalId: 'synthetic-smtp-' + purpose,
        recipients: [{ email: 'synthetic-' + purpose + '-signer@example.test', name: 'Synthetic signer', role: 'SIGNER',
          fields: [{ identifier: 0, type: 'SIGNATURE', page: 1, positionX: 10, positionY: 60, width: 30, height: 8 }] }],
        meta: { emailSettings: { recipientSigned: false, ownerDocumentCompleted: false, ownerRecipientExpired: false, ownerDocumentCreated: false } } };
      const form = new FormData(); form.append('payload', JSON.stringify(payload)); form.append('files', new Blob([bytes], { type: 'application/pdf' }), 'synthetic.pdf');
      const created = await fetch('http://localhost:3000/api/v2/envelope/create', { method: 'POST', body: form,
        headers: { authorization: credential.apiToken }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      const envelope = await created.json();
      if (!created.ok || typeof envelope.id !== 'string') throw Error('Synthetic envelope creation failed');
      const distributed = await fetch('http://localhost:3000/api/v2/envelope/distribute', { method: 'POST',
        headers: { authorization: credential.apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ envelopeId: envelope.id }), redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!distributed.ok) throw Error('Synthetic envelope distribution failed');
    }
    for (let n = 0; n < 90; n++) {
      const sent = await prisma.recipient.findMany({ where: { email: { in: ['synthetic-main-signer@example.test', 'synthetic-qa-signer@example.test'] } }, select: { email: true, sendStatus: true } });
      const capture = await fetch('http://capture:8025/api/v1/messages', { signal: AbortSignal.timeout(5000) }); const data = await capture.json();
      const qaCaptured = data.messages?.some(message => message.To?.some(to => to.Address === 'synthetic-qa-signer@example.test'));
      const mainCaptured = data.messages?.some(message => message.To?.some(to => to.Address === 'synthetic-main-signer@example.test'));
      if (sent.length === 2 && sent.every(row => row.sendStatus === 'SENT') && qaCaptured && !mainCaptured) {
        console.log(JSON.stringify({ pass: true, mainSmtpSent: true, qaCaptured: true, mainNotCaptured: true })); return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Synthetic per-organization routing did not complete');
  } finally { await prisma.$disconnect(); }
})().catch(() => { console.log(JSON.stringify({ pass: false })); process.exitCode = 1; });

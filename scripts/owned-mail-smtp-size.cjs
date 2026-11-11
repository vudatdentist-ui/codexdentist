// SMTP greeting/size check only: never RCPT or DATA, so no email is submitted.
async function probe({ host, ca }) {
  if (!['127.0.0.1', 'codexdentist-mail-smtp'].includes(host) || !Buffer.isBuffer(ca)) throw Error('Owned SMTP size probe required');
  const socket = require('node:tls').connect({ host, port: 2465, ca, servername: 'codexdentist-mail-smtp', rejectUnauthorized: true });
  let buffered = '', waiter, failure;
  socket.setEncoding('utf8'); socket.setTimeout(5000, () => socket.destroy(Error('Private SMTP size timeout')));
  function drain() {
    const match = buffered.match(/(?:^|\r\n)\d{3} [^\r\n]*\r\n/);
    if (waiter && match) {
      const end = match.index + match[0].length, value = buffered.slice(0, end); buffered = buffered.slice(end);
      const current = waiter; waiter = null; current.resolve(value);
    }
  }
  const response = () => new Promise((resolve, reject) => { if (failure) return reject(failure); waiter = { resolve, reject }; drain(); });
  socket.on('data', chunk => { buffered += chunk; if (buffered.length > 8192) socket.destroy(Error('Private SMTP response too large')); else drain(); });
  socket.on('error', error => { failure = error; waiter?.reject(error); waiter = null; });
  socket.on('close', () => { failure ??= Error('Private SMTP closed'); waiter?.reject(failure); waiter = null; });
  try {
    if (!/^220 /.test(await response())) throw Error('Private SMTP greeting differs');
    socket.write('EHLO synthetic.example.test\r\n'); const hello = await response();
    const advertised = Number(hello.match(/250[- ]SIZE (\d+)/)?.[1]);
    if (advertised !== 80 * 1024 * 1024) throw Error('Exact bounded attachment-capable SMTP limit required');
    socket.write('MAIL FROM:<no-reply@codexdentist.com> SIZE=' + (advertised + 1) + '\r\n');
    if (!/^552 /.test(await response())) throw Error('Oversized message must reject before recipient or body');
    return { pass: true, smtpMaxBytes: advertised, declaredOversizeDenied: true, messageSubmitted: false };
  } finally { socket.destroy(); }
}
module.exports = { probe };

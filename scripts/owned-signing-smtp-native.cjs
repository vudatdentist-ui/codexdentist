// Synthetic-only TLS SMTP receiver. It has no outbound network or forwarding.
const tls = require('node:tls'), fs = require('node:fs');
const server = tls.createServer({ key: fs.readFileSync('/proof/server.key.pem'), cert: fs.readFileSync('/proof/server.cert.pem') }, socket => {
  socket.setTimeout(15000, () => socket.destroy()); socket.on('error', () => {});
  socket.write('220 synthetic owned SMTP\r\n'); let pending = '', data = false, lines = [], recipient = '';
  socket.on('data', chunk => {
    pending += chunk; if (pending.length > 2 * 1024 * 1024) return socket.destroy();
    for (;;) {
      const index = pending.indexOf('\r\n'); if (index < 0) break;
      const line = pending.slice(0, index); pending = pending.slice(index + 2);
      if (data) {
        if (line === '.') {
          fs.appendFileSync('/proof/messages.jsonl', JSON.stringify({ recipient, bytes: Buffer.byteLength(lines.join('\r\n')) }) + '\n');
          data = false; lines = []; socket.write('250 queued privately\r\n');
        } else lines.push(line);
      } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250 synthetic.local\r\n');
      else if (/^MAIL FROM:/i.test(line)) socket.write('250 sender accepted\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.slice(8).trim();
        if (!/^<synthetic-[a-z-]+@example\.test>$/.test(recipient)) return socket.destroy();
        socket.write('250 synthetic recipient accepted\r\n');
      } else if (/^DATA$/i.test(line)) { data = true; socket.write('354 end with dot\r\n'); }
      else if (/^QUIT$/i.test(line)) socket.end('221 bye\r\n');
      else if (/^(RSET|NOOP)$/i.test(line)) socket.write('250 ok\r\n');
      else socket.write('502 unavailable\r\n');
    }
  });
});
server.listen(2465, '0.0.0.0');

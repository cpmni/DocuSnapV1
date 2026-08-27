// Minimal CDP driver (no deps): evaluate a JS expression file in the page whose title/url matches a regex.
//   electron(as node) cdp_eval.js <port> <targetRegex> <exprFile> [timeoutMs]
// Prints {targets:[...]} when no exprFile is given. Own RFC-6455 client (Electron 31's Node has no global WebSocket).
const http = require('http'), crypto = require('crypto'), net = require('net'), fs = require('fs');
const [port, targetRe, exprFile, timeoutArg] = process.argv.slice(2);
const TIMEOUT = Number(timeoutArg) || 600000;
function getJson(url) { return new Promise((res, rej) => http.get(url, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej)); }
class WS {
  constructor(url) { this.url = new URL(url); this.buf = Buffer.alloc(0); this.handlers = []; this.frag = ''; }
  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(Number(this.url.port), this.url.hostname, () => {
        sock.write(`GET ${this.url.pathname}${this.url.search} HTTP/1.1\r\nHost: ${this.url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      this.sock = sock; let upgraded = false;
      sock.on('data', (d) => {
        if (!upgraded) {
          const s = d.toString('latin1'); const i = s.indexOf('\r\n\r\n'); if (i < 0) return;
          upgraded = true; const rest = d.slice(Buffer.byteLength(s.slice(0, i + 4), 'latin1'));
          this.buf = Buffer.concat([this.buf, rest]); resolve(); this._parse(); return;
        }
        this.buf = Buffer.concat([this.buf, d]); this._parse();
      });
      sock.on('error', reject);
    });
  }
  _parse() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1]; const fin = (b0 & 0x80) !== 0; const op = b0 & 0x0f;
      let len = b1 & 0x7f; let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if ((b1 & 0x80) !== 0) off += 4;
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len); this.buf = this.buf.slice(off + len);
      if (op === 0x1 || op === 0x0) { this.frag += payload.toString('utf8'); if (fin) { const m = this.frag; this.frag = ''; this.handlers.forEach(h => h(m)); } }
      else if (op === 0x8) { try { this.sock.end(); } catch {} }
      else if (op === 0x9) { this._send(payload, 0xA); }
    }
  }
  _send(payload, op = 0x1) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'); const mask = crypto.randomBytes(4);
    let hdr;
    if (data.length < 126) hdr = Buffer.from([0x80 | op, 0x80 | data.length]);
    else if (data.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 0x80 | 126; hdr.writeUInt16BE(data.length, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 0x80 | 127; hdr.writeBigUInt64BE(BigInt(data.length), 2); }
    const m = Buffer.alloc(data.length); for (let i = 0; i < data.length; i++) m[i] = data[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([hdr, mask, m]));
  }
  send(obj) { this._send(JSON.stringify(obj)); }
  onMessage(h) { this.handlers.push(h); }
  close() { try { this.sock.end(); } catch {} }
}
(async () => {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const pages = targets.filter(t => t.type === 'page').map(t => ({ id: t.id, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }));
  if (!exprFile) { console.log(JSON.stringify({ targets: pages }, null, 1)); return; }
  const re = new RegExp(targetRe, 'i');
  const tgt = pages.find(t => re.test(t.title) || re.test(t.url));
  if (!tgt) { console.log(JSON.stringify({ error: 'no target', targets: pages })); process.exit(2); }
  const ws = new WS(tgt.ws); await ws.connect();
  let nextId = 1; const pending = new Map();
  ws.onMessage((m) => { let j; try { j = JSON.parse(m); } catch { return; } if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } });
  const call = (method, params = {}) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send({ id, method, params }); });
  const expression = fs.readFileSync(exprFile, 'utf8');
  const timer = setTimeout(() => { console.log(JSON.stringify({ error: 'timeout' })); process.exit(3); }, TIMEOUT);
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  clearTimeout(timer);
  console.log(JSON.stringify({ target: { title: tgt.title, url: tgt.url }, result: r.result && r.result.result ? r.result.result.value : null, exception: r.result && r.result.exceptionDetails ? r.result.exceptionDetails : null, error: r.error || null }, null, 1));
  ws.close();
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.message || e) })); process.exit(1); });

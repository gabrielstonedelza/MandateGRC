// Test harness: a throwaway MandateGRC server with its own data directory, and a client that
// signs up with a software passkey (test only). Each call to startServer() is fully isolated.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const b64u = (b) => Buffer.from(b).toString('base64url');
function cbor(v) {
  const h = (mj, n) => (n < 24 ? Buffer.from([(mj << 5) | n]) : n < 256 ? Buffer.from([(mj << 5) | 24, n]) : Buffer.from([(mj << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? h(0, v) : h(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([h(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([h(2, v.length), v]);
  return Buffer.concat([h(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
function softCredential(pk, origin) {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = kp.publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(32), len = Buffer.alloc(2), cnt = Buffer.alloc(4);
  len.writeUInt16BE(32); cnt.writeUInt32BE(1);
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(j.x, 'base64url')], [-3, Buffer.from(j.y, 'base64url')]]);
  const ad = Buffer.concat([crypto.createHash('sha256').update(pk.rp.id).digest(), Buffer.from([0x45]), cnt, Buffer.alloc(16), len, id, cbor(cose)]);
  return {
    id: b64u(id),
    clientDataJSON: b64u(JSON.stringify({ type: 'webauthn.create', challenge: pk.challenge, origin })),
    attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]))),
  };
}

export async function startServer() {
  const port = 4500 + Math.floor(Math.random() * 400);
  const base = `http://localhost:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandategrc-test-'));
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), MANDATEGRC_DATA_DIR: dataDir }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { await fetch(base + '/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const stop = () => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { base, stop, dbPath: path.join(dataDir, 'mandate.db') };
}

// A signed-in client. `client(base)` creates a new workspace; `client(base, { invite })` joins one.
export async function client(base, { username = `u${crypto.randomBytes(4).toString('hex')}`, org = 'Test Org', invite = null } = {}) {
  let cookie = '', csrf = '';
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie, 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; e.data = data; throw e; }
    return data;
  };
  let res;
  if (invite) {
    const o = await call('POST', '/api/auth/register/options', { code: invite });
    res = await call('POST', '/api/auth/register/verify', { challengeId: o.challengeId, credential: softCredential(o.publicKey, base), username, name: username, label: 'test' });
  } else {
    const o = await call('POST', '/api/auth/signup/options', {});
    res = await call('POST', '/api/auth/signup/verify', { challengeId: o.challengeId, credential: softCredential(o.publicKey, base), username, name: username, org_name: org, sample: false, label: 'test' });
  }
  csrf = res.csrf;
  const raw = (p) => fetch(base + p, { headers: { Cookie: cookie } });
  return { user: res.user, raw, get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: (p) => call('DELETE', p, {}) };
}

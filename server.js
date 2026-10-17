// MandateGRC — policy-first GRC workbench. Zero third-party dependencies.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchRoute } from './src/api.js';
import { bootstrap } from './src/seed.js';
import {
  COOKIE_NAME, parseCookies, loadSession, securityHeaders, rateLimit, safeEqual, purgeExpiredSessions,
} from './src/security.js';
import { HttpError } from './src/util.js';
import { db } from './src/db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || '127.0.0.1';
const TLS = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) } : null;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PRODUCTION = process.env.NODE_ENV === 'production';
// The public URL (e.g. https://mandategrc.app). Passkeys are bound to it, so production must set it.
const ORIGIN = (process.env.MANDATEGRC_ORIGIN || process.env.MANDATE_ORIGIN || '').replace(/\/+$/, '');
if (PRODUCTION && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(ORIGIN)) {
  console.error('\n  ✖ NODE_ENV=production requires MANDATEGRC_ORIGIN, the public https URL, e.g. MANDATEGRC_ORIGIN=https://mandategrc.app\n');
  process.exit(1);
}
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url, ip, secure) {
  const m = matchRoute(req.method, url.pathname);
  if (!m) throw new HttpError(404, 'Not found');
  if (m.methodMismatch) throw new HttpError(405, 'Method not allowed');
  const { route, params } = m;

  const general = rateLimit('api:' + ip, 600, 60_000);
  if (!general.ok) throw new HttpError(429, 'Too many requests');

  const isWrite = !['GET', 'HEAD'].includes(req.method);
  if (isWrite) {
    // Reject cross-site requests outright (defence in depth alongside SameSite=Strict + CSRF token).
    const origin = req.headers.origin;
    const expected = ORIGIN || `${secure ? 'https' : 'http'}://${req.headers.host}`;
    if (origin && origin !== expected) throw new HttpError(403, 'Cross-origin request blocked');
    // Requests with a body must send JSON. Body-less writes (e.g. DELETE) are still protected by the
    // Origin check above and the CSRF token below.
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    if (hasBody && !/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Content-Type must be application/json');
  }

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const ctx = {
    req, ip, secure, params, query: url.searchParams, token, body: {},
    setHeader: (k, v) => res.setHeader(k, v),
  };

  if (!route.opts.public) {
    const s = loadSession(token);
    if (!s) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    ctx.session = s;
    ctx.user = { id: s.user_id, username: s.username, name: s.name, role: s.role, org_id: s.org_id };
    ctx.actor = { user_id: s.user_id, username: s.username, org_id: s.org_id };
    if (isWrite && !safeEqual(req.headers['x-csrf-token'], s.csrf)) throw new HttpError(403, 'Invalid CSRF token');
    if (!route.roles.includes(s.role)) throw new HttpError(403, 'Your role does not permit this action.');
  }

  if (isWrite) {
    const raw = await readBody(req);
    if (raw) {
      try { ctx.body = JSON.parse(raw); } catch { throw new HttpError(400, 'Malformed JSON'); }
      if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, 'Body must be a JSON object');
    }
  }

  const result = await route.handler(ctx);
  if (result && result.__raw !== undefined) {
    return send(res, 200, result.__raw, {
      'Content-Type': result.contentType, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${result.filename.replace(/[^\w.-]/g, '_')}"`,
    });
  }
  sendJson(res, 200, result ?? { ok: true });
}

function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'Forbidden');
  let stat = null;
  try { stat = fs.statSync(file); } catch { /* fall through to SPA */ }
  if (!stat || stat.isDirectory()) {
    if (path.extname(rel)) return send(res, 404, 'Not found');
    file = path.join(PUBLIC, 'index.html');
  }
  const ext = path.extname(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function handler(req, res) {
  const secure = !!TLS || ORIGIN.startsWith('https://') || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
  // Behind a proxy, trust only the address the proxy itself added (the last X-Forwarded-For entry),
  // never the client-supplied first one, so rate limits cannot be dodged by spoofing the header.
  const forwarded = String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const ip = (TRUST_PROXY && forwarded[forwarded.length - 1]) || req.socket.remoteAddress || 'unknown';
  for (const [k, v] of Object.entries(securityHeaders(secure))) res.setHeader(k, v);
  res.setHeader('X-Powered-By', '');
  res.removeHeader('X-Powered-By');
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Bad request'); }
  // Health check for the hosting platform (no auth, no personal data).
  if (url.pathname === '/healthz') {
    try { db.prepare('SELECT 1').get(); return sendJson(res, 200, { ok: true }); } catch { return sendJson(res, 503, { ok: false }); }
  }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, ip, secure);
    else serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401 && url.pathname !== '/api/auth/login') res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
      sendJson(res, e.status, { error: e.message, code: e.code, details: e.details });
    } else {
      console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`, e);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }
}

const setup = await bootstrap();
setInterval(purgeExpiredSessions, 10 * 60_000).unref();

const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} is already in use. MandateGRC (or another app) is probably already running.`);
    console.error(`    Open http://localhost:${PORT}, stop the other process (Ctrl+C in its terminal),`);
    console.error(`    or start on another port:  PORT=4301 npm start\n`);
  } else if (e.code === 'EACCES') {
    console.error(`\n  ✖ No permission to listen on port ${PORT}. Use a port above 1024, e.g. PORT=4300 npm start\n`);
  } else {
    console.error('\n  ✖ Server failed to start:', e.message, '\n');
  }
  process.exit(1);
});
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
// Graceful shutdown: finish in-flight requests, then close the database cleanly (checkpoints the WAL).
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n  ${signal} received, shutting down…`);
  server.close(() => { try { db.close(); } catch { /* already closed */ } process.exit(0); });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  // Passkeys require a domain name (WebAuthn forbids IP addresses), so local use is via "localhost".
  const url = ORIGIN || `${TLS ? 'https' : 'http'}://${['0.0.0.0', '127.0.0.1', '::', '::1'].includes(HOST) ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  ▣ MandateGRC is running at ${url}\n`);
  if (setup?.legacyBackup) {
    console.log('  Upgraded to multi-workspace storage. The previous single-workspace database was kept as:');
    console.log(`  ${setup.legacyBackup}\n`);
  }
  console.log(`  Open ${url} and click "Get started" to create your workspace.\n`);
});

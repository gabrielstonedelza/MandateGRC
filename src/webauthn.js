// Passkey (WebAuthn / FIDO2) relying-party implementation using only node:crypto.
// Supports ES256 (P-256), EdDSA (Ed25519) and RS256. Attestation "none":
// we trust the authenticator's key binding, not its manufacturer.
import crypto from 'node:crypto';
import { HttpError } from './util.js';

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 8192) throw new HttpError(400, 'Malformed passkey response');
  return Buffer.from(s, 'base64url');
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

// ---------- Relying party identity ----------
// MANDATE_ORIGIN pins the origin in production (e.g. https://mandategrc.app).
// Without it, the origin is derived from the request (fine for localhost development).
export function relyingParty(req, secure) {
  if ((process.env.MANDATEGRC_ORIGIN || process.env.MANDATE_ORIGIN)) {
    const u = new URL((process.env.MANDATEGRC_ORIGIN || process.env.MANDATE_ORIGIN));
    return { id: u.hostname, origin: u.origin, name: 'MandateGRC' };
  }
  const host = String(req.headers.host || 'localhost');
  const origin = `${secure ? 'https' : 'http'}://${host}`;
  return { id: new URL(origin).hostname, origin, name: 'MandateGRC' };
}

// ---------- Single-use challenges (5 minutes, in memory) ----------
const challenges = new Map();
export function issueChallenge(purpose, data = {}) {
  const id = crypto.randomBytes(16).toString('base64url');
  const challenge = crypto.randomBytes(32);
  challenges.set(id, { purpose, challenge, data, expires: Date.now() + 5 * 60_000 });
  return { challengeId: id, challenge: b64url(challenge) };
}
export function consumeChallenge(id, purpose) {
  const c = challenges.get(String(id || ''));
  challenges.delete(String(id || ''));
  if (!c || c.purpose !== purpose || c.expires < Date.now()) throw new HttpError(400, 'This sign-in request has expired. Please try again.');
  return c;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k); }, 60_000).unref();

// ---------- Minimal CBOR decoder (RFC 8949 subset used by WebAuthn) ----------
function decodeCbor(buf) {
  let pos = 0;
  const readLen = (info) => {
    if (info < 24) return info;
    if (info === 24) return buf[pos++];
    if (info === 25) { const v = buf.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(pos)); pos += 8; return v; }
    throw new Error('Unsupported CBOR length');
  };
  const item = (depth = 0) => {
    if (depth > 16 || pos >= buf.length) throw new Error('Invalid CBOR');
    const b = buf[pos++];
    const major = b >> 5, info = b & 31;
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); const v = buf.subarray(pos, pos + n); pos += n; return v; }
      case 3: { const n = readLen(info); const v = buf.subarray(pos, pos + n).toString('utf8'); pos += n; return v; }
      case 4: { const n = readLen(info); const a = []; for (let i = 0; i < n; i++) a.push(item(depth + 1)); return a; }
      case 5: { const n = readLen(info); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error('Unsupported CBOR simple value');
      default: throw new Error('Unsupported CBOR type');
    }
  };
  const value = item();
  return { value, length: pos };
}

// ---------- Authenticator data ----------
function parseAuthData(ad) {
  if (ad.length < 37) throw new HttpError(400, 'Malformed authenticator data');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  out.up = !!(out.flags & 0x01);
  out.uv = !!(out.flags & 0x04);
  if (out.flags & 0x40) {
    const credLen = ad.readUInt16BE(53);
    out.credentialId = ad.subarray(55, 55 + credLen);
    const { value } = decodeCbor(ad.subarray(55 + credLen));
    out.coseKey = value;
  }
  return out;
}

// COSE_Key → Node KeyObject
function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    return { alg, key: crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(cose.get(-2)), y: b64url(cose.get(-3)) }, format: 'jwk' }) };
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    return { alg, key: crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(cose.get(-2)) }, format: 'jwk' }) };
  }
  if (kty === 3 && alg === -257) {
    return { alg, key: crypto.createPublicKey({ key: { kty: 'RSA', n: b64url(cose.get(-1)), e: b64url(cose.get(-2)) }, format: 'jwk' }) };
  }
  throw new HttpError(400, 'This authenticator uses an unsupported key type.');
}

function checkClientData(clientDataJSON, type, challenge, rp) {
  let cd;
  try { cd = JSON.parse(clientDataJSON.toString('utf8')); } catch { throw new HttpError(400, 'Malformed client data'); }
  if (cd.type !== type) throw new HttpError(400, 'Unexpected passkey operation');
  if (!crypto.timingSafeEqual(Buffer.from(String(cd.challenge || '')), Buffer.from(b64url(challenge)))) throw new HttpError(400, 'Challenge mismatch');
  if (cd.origin !== rp.origin) throw new HttpError(400, 'Passkey was created for a different site');
  if (cd.crossOrigin === true) throw new HttpError(400, 'Cross-origin passkey use is not allowed');
}

function checkRp(auth, rp) {
  if (!crypto.timingSafeEqual(auth.rpIdHash, sha256(Buffer.from(rp.id)))) throw new HttpError(400, 'Passkey belongs to a different site');
  if (!auth.up) throw new HttpError(400, 'User presence was not confirmed');
  if (!auth.uv) throw new HttpError(400, 'Biometric or device PIN verification is required');
}

// ---------- Ceremonies ----------
export function verifyRegistration(body, challenge, rp) {
  const clientDataJSON = fromB64url(body.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.create', challenge, rp);
  let att;
  try { att = decodeCbor(fromB64url(body.attestationObject)).value; } catch { throw new HttpError(400, 'Malformed attestation'); }
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw new HttpError(400, 'Malformed attestation');
  const auth = parseAuthData(att.get('authData'));
  checkRp(auth, rp);
  if (!auth.credentialId || !auth.coseKey) throw new HttpError(400, 'No credential in response');
  if (b64url(auth.credentialId) !== body.id) throw new HttpError(400, 'Credential id mismatch');
  const { alg, key } = coseToKey(auth.coseKey);
  const transports = Array.isArray(body.transports) ? body.transports.filter((t) => /^[a-z-]{2,20}$/.test(t)).slice(0, 6) : [];
  return {
    id: b64url(auth.credentialId),
    publicKey: key.export({ type: 'spki', format: 'pem' }),
    alg,
    signCount: auth.signCount,
    transports,
    backedUp: !!(auth.flags & 0x10),
  };
}

export function verifyAssertion(body, challenge, rp, cred) {
  const clientDataJSON = fromB64url(body.clientDataJSON);
  checkClientData(clientDataJSON, 'webauthn.get', challenge, rp);
  const authData = fromB64url(body.authenticatorData);
  const auth = parseAuthData(authData);
  checkRp(auth, rp);
  const data = Buffer.concat([authData, sha256(clientDataJSON)]);
  const sig = fromB64url(body.signature);
  const key = crypto.createPublicKey(cred.public_key);
  const ok = cred.alg === -8
    ? crypto.verify(null, data, key, sig)
    : crypto.verify('sha256', data, cred.alg === -7 ? { key, dsaEncoding: 'der' } : key, sig);
  if (!ok) throw new HttpError(401, 'Passkey signature could not be verified.');
  // Cloned-authenticator detection: counters must increase when the device supports them.
  if (auth.signCount !== 0 || cred.sign_count !== 0) {
    if (auth.signCount <= cred.sign_count) throw new HttpError(401, 'This passkey appears to have been cloned. Contact your administrator.');
  }
  return { signCount: auth.signCount };
}

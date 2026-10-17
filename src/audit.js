// Tamper-evident audit trail: every entry carries SHA-256(prev_hash + canonical entry).
// Each workspace has its own chain, so one organization can verify its trail without
// seeing anyone else's. The table is append-only (SQLite triggers); verifyChain() proves integrity.
import crypto from 'node:crypto';
import { all, get, run } from './db.js';

const GENESIS = '0'.repeat(64);

function digest(prev, e) {
  const canonical = JSON.stringify([e.org_id, e.ts, e.user_id, e.username, e.action, e.entity, e.entity_id, e.details]);
  return crypto.createHash('sha256').update(prev + '|' + canonical).digest('hex');
}

// actor: { user_id, username, org_id }. IP addresses are never recorded (data minimisation).
export function audit(actor, action, entity = null, entityId = null, details = null) {
  const orgId = actor?.org_id ?? null;
  const last = get('SELECT hash FROM audit_log WHERE org_id IS ? ORDER BY id DESC LIMIT 1', orgId);
  const e = {
    org_id: orgId,
    ts: new Date().toISOString(),
    user_id: actor?.user_id ?? actor?.id ?? null,
    username: actor?.username ?? 'system',
    action,
    entity,
    entity_id: entityId == null ? null : String(entityId),
    details: details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details)),
  };
  const prev = last ? last.hash : GENESIS;
  const hash = digest(prev, e);
  run(`INSERT INTO audit_log(org_id, ts, user_id, username, action, entity, entity_id, details, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?)`, e.org_id, e.ts, e.user_id, e.username, e.action, e.entity, e.entity_id, e.details, prev, hash);
}

export function verifyChain(orgId) {
  const rows = all('SELECT * FROM audit_log WHERE org_id IS ? ORDER BY id ASC', orgId);
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || digest(prev, r) !== r.hash) {
      return { ok: false, entries: rows.length, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { ok: true, entries: rows.length, head: prev };
}

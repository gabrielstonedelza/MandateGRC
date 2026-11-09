// Asset register for scoping: what you protect, who owns it, how sensitive it is and where it runs.
// Assets name the policies, controls and risks that cover them, and the frameworks whose scope they
// fall in (e.g. ISO 27001 ISMS scope, PCI DSS cardholder data environment). Every change is audited.
import { all, get, run, tx, nextCode } from './db.js';
import { audit } from './audit.js';
import { HttpError, bad, nowIso, parseJson, str, oneOf, idList } from './util.js';

export const ASSET_TYPES = ['System', 'Application', 'Data', 'Cloud service', 'Network', 'Endpoint', 'Facility', 'Other'];
export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'];
export const ENVIRONMENTS = ['Production', 'Staging', 'Development', 'Corporate'];

export function registerAssetRoutes({ route, R, pid, notFound, userName, visibleFrameworks }) {
  const hydrate = (a) => ({ ...a, scope_tags: parseJson(a.scope_tags, []), policy_ids: parseJson(a.policy_ids, []), control_ids: parseJson(a.control_ids, []), risk_ids: parseJson(a.risk_ids, []), owner_name: userName(a.owner_id) });
  const row = (id, org) => { const a = get('SELECT * FROM assets WHERE id = ? AND org_id = ?', id, org); if (!a) throw notFound('Asset'); return a; };
  const own = (table, ids, org) => ids.filter((id) => get(`SELECT id FROM ${table} WHERE id = ? AND org_id = ?`, id, org));

  function validate(b, org) {
    const owner = b.owner_id == null || b.owner_id === '' ? null : Number(b.owner_id);
    if (owner != null && !get('SELECT id FROM users WHERE id = ? AND org_id = ? AND active = 1', owner, org)) throw bad('Asset owner must be an active user in this workspace.');
    const codes = new Set(visibleFrameworks(org).map((f) => f.code));
    const tags = Array.isArray(b.scope_tags) ? [...new Set(b.scope_tags.map(String))] : [];
    if (tags.some((t) => !codes.has(t))) throw bad('Unknown framework in scope.');
    return {
      name: str(b.name, { name: 'Asset name', min: 2, max: 200, required: true }),
      asset_type: oneOf(b.asset_type, ASSET_TYPES, { name: 'Type' }),
      description: str(b.description, { name: 'Description', max: 2000 }),
      owner_id: owner,
      classification: oneOf(b.classification, CLASSIFICATIONS, { name: 'Classification' }),
      environment: oneOf(b.environment, ENVIRONMENTS, { name: 'Environment' }),
      scope_tags: tags,
      policy_ids: own('policies', idList(b.policy_ids || [], { name: 'Policies' }), org),
      control_ids: own('org_controls', idList(b.control_ids || [], { name: 'Controls' }), org),
      risk_ids: own('risks', idList(b.risk_ids || [], { name: 'Risks' }), org),
    };
  }

  // Filter by what references an asset: ?policy_id= / ?control_id= / ?risk_id= / ?scope=ISO27001
  route('GET', '/api/assets', R.READ, (ctx) => {
    let list = all('SELECT * FROM assets WHERE org_id = ? ORDER BY code', ctx.user.org_id).map(hydrate);
    const q = ctx.query;
    for (const [k, f] of [['policy_id', 'policy_ids'], ['control_id', 'control_ids'], ['risk_id', 'risk_ids']]) {
      if (q.get(k)) { const n = Number(q.get(k)); list = list.filter((a) => a[f].includes(n)); }
    }
    if (q.get('scope')) list = list.filter((a) => a.scope_tags.includes(q.get('scope')));
    return list;
  });

  route('POST', '/api/assets', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const v = validate(ctx.body, org);
    return tx(() => {
      const code = nextCode('assets', 'AST', org);
      const id = Number(run(`INSERT INTO assets(org_id, code, name, asset_type, description, owner_id, classification, environment, scope_tags, policy_ids, control_ids, risk_ids, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, org, code, v.name, v.asset_type, v.description, v.owner_id, v.classification, v.environment,
      JSON.stringify(v.scope_tags), JSON.stringify(v.policy_ids), JSON.stringify(v.control_ids), JSON.stringify(v.risk_ids), ctx.user.id).lastInsertRowid);
      audit(ctx.actor, 'asset.created', 'asset', id, { code, name: v.name, classification: v.classification, environment: v.environment, scope: v.scope_tags });
      return { id, code };
    });
  });

  route('PUT', '/api/assets/:id', R.WRITE, (ctx) => {
    const org = ctx.user.org_id;
    const old = hydrate(row(pid(ctx.params.id), org));
    if (old.status === 'retired') throw new HttpError(409, 'Retired assets cannot be edited. Reactivate it first.');
    const v = validate(ctx.body, org);
    const changed = Object.keys(v).filter((k) => JSON.stringify(v[k] ?? null) !== JSON.stringify(old[k] ?? null));
    tx(() => {
      run(`UPDATE assets SET name=?, asset_type=?, description=?, owner_id=?, classification=?, environment=?, scope_tags=?, policy_ids=?, control_ids=?, risk_ids=?, updated_at=? WHERE id=?`,
        v.name, v.asset_type, v.description, v.owner_id, v.classification, v.environment, JSON.stringify(v.scope_tags), JSON.stringify(v.policy_ids), JSON.stringify(v.control_ids), JSON.stringify(v.risk_ids), nowIso(), old.id);
      audit(ctx.actor, 'asset.updated', 'asset', old.id, { code: old.code, changed, ...(changed.includes('classification') ? { classification: [old.classification, v.classification] } : {}), ...(changed.includes('scope_tags') ? { scope: [old.scope_tags, v.scope_tags] } : {}) });
    });
    return { ok: true };
  });

  route('POST', '/api/assets/:id/status', R.WRITE, (ctx) => {
    const a = row(pid(ctx.params.id), ctx.user.org_id);
    const status = oneOf(ctx.body.status, ['active', 'retired'], { name: 'Status' });
    if (status === a.status) return { ok: true };
    const reason = str(ctx.body.reason, { name: 'Reason', min: status === 'retired' ? 5 : 0, max: 500, required: status === 'retired' });
    tx(() => {
      run('UPDATE assets SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), a.id);
      audit(ctx.actor, status === 'retired' ? 'asset.retired' : 'asset.reactivated', 'asset', a.id, { code: a.code, reason });
    });
    return { ok: true };
  });

  return { list: (org) => all('SELECT * FROM assets WHERE org_id = ? ORDER BY code', org).map(hydrate) };
}

// Shared fixtures for the unit tests: the built-in control catalogue with stable ids, and
// policies built from the templates. Pure: no database, no server.
import { FRAMEWORKS } from '../src/frameworks.js';
import { TEMPLATES } from '../src/templates.js';

let n = 0;
export const CONTROLS = FRAMEWORKS.flatMap((f) => f.controls.map(([ref, title, family, themes]) => ({ id: ++n, ref, title, family, themes, framework_code: f.code })));
export const CONTROLS_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));
export const ctl = (key) => {
  const [fw, ref] = key.includes(':') ? key.split(/:(.*)/) : key.split(/ (.*)/);
  const c = CONTROLS.find((x) => x.framework_code === fw && x.ref === ref);
  if (!c) throw new Error(`Unknown control ${key}`);
  return c.id;
};
export const opts = { controlsById: CONTROLS_BY_ID, today: '2026-11-08' };

export function templatePolicy(key) {
  const t = TEMPLATES.find((x) => x.key === key);
  return {
    title: t.title, owner: t.owner, purpose: t.purpose, scope: t.scope, enforcement: t.enforcement,
    policy_type: t.type, status: 'draft', version: '0.0', effective_date: '2026-11-01', review_cycle_months: 12, ref_controls: [],
    statements: t.statements.map(([text, refs], i) => ({ id: `s${i + 1}`, text, controls: refs.map((r) => ctl(r)) })),
    roles: t.roles.map((r) => ({ ...r })),
  };
}
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

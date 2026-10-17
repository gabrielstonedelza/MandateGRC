import { html, state } from '../core.js';
import { riskLevel } from '../lint.js';

// 5x5 heat map: rows = likelihood (5 at top), columns = impact.
export function heatMap(matrix, { appetite = 9, selectable = false, selected = null } = {}) {
  const cells = [];
  for (let l = 5; l >= 1; l--) {
    cells.push(html`<div class="ax">${l}</div>`);
    for (let i = 1; i <= 5; i++) {
      const n = matrix[l - 1][i - 1];
      const lvl = riskLevel(l * i).key;
      const sel = selected && selected[0] === l && selected[1] === i;
      cells.push(html`<div class="cell h-${lvl} ${n ? 'has' : 'empty'} ${l * i <= appetite ? 'appetite' : ''} ${sel ? 'has' : ''}"
        ${selectable ? html`data-cell="${l},${i}" role="button" tabindex="0"` : ''} title="Likelihood ${l} × Impact ${i} = ${l * i} (${riskLevel(l * i).label})">${n || ''}</div>`);
    }
  }
  return html`<div class="heat">${cells}<div></div>${[1, 2, 3, 4, 5].map((i) => html`<div class="ax">${i}</div>`)}</div>
    <div class="heat-legend"><span>↑ Likelihood · Impact →</span><span>Dashed = within appetite (≤ ${appetite})</span></div>`;
}

export const controlById = (id) => state.meta.controls.find((c) => c.id === id);
export const fwName = (code) => state.meta.frameworks.find((f) => f.code === code)?.name || code;
export const ctrlLabel = (c) => (c ? `${c.framework_code} ${c.ref}` : 'Unknown control');

export const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
export const IMPACT = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe'];

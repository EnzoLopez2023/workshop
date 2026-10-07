// The build packet: everything for the shop in one printable document — the
// design at a glance, cut list, cutting order, hardware and cost, shop jigs and
// 3D-print list — ahead of the illustrated build guide (see guidePrintHtml).

import { escapeHtmlText as esc } from './buildGuide.ts';
import { cuttingOrder } from './cuttingOrder.ts';
import type { DrawerJig } from './drawerExport.ts';
import { BASE_LABELS, boxedDrawers, sheetParts, type DrawerConfig, type DrawerPlan } from './drawerUnit.ts';
import { GF_PITCH, GF_UNIT } from './gridfinity.ts';
import { partSvg } from './shelfExport.ts';
import { formatLength, type LengthUnit } from './shelving.ts';

export interface PacketCost {
  lines: { name: string; qtyLabel: string; total: number; optional: boolean }[];
  total: number;
}

export interface PacketHardware {
  name: string;
  qty: number;
  unit: string;
  note?: string;
}

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const money = (n: number) => `$${n.toFixed(2)}`;

export function drawerPacketHtml(input: {
  plan: DrawerPlan;
  config: DrawerConfig;
  units: LengthUnit;
  hardware: PacketHardware[];
  quantity: (qty: number, unit: string) => string;
  cost?: PacketCost;
  jigs: DrawerJig[];
}): string {
  const { plan, config, units, hardware, quantity, cost, jigs } = input;
  const f = (inches: number) => formatLength(inches, units);
  const metric = units === 'mm';
  const boxed = boxedDrawers(plan);
  const fact = (label: string, value: string) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;

  const summary = `
  <section class="packet">
    <h2>At a glance</h2>
    <dl class="facts">
      ${fact('Overall', `${f(plan.overallWidth)} × ${f(plan.overallHeight)} × ${f(plan.overallDepth)}`)}
      ${fact('Drawers', `${boxed.length * plan.unitCount}${plan.columns.length > 1 ? ` in ${plan.columns.length} columns` : ''}`)}
      ${fact('Slides', [...new Set(boxed.map(d => d.box.depth))].map(l => `${f(l)} LONTAN`).join(', ') || '—')}
      ${fact('Mounting', plan.mount === 'wall' ? 'French cleat' : plan.mount === 'under-desk' ? 'Under a desk' : BASE_LABELS[config.base])}
    </dl>
  </section>`;

  const cutList = `
  <section class="packet">
    <h2>Cut list</h2>
    <table><thead><tr><th>Part</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Notes</th></tr></thead><tbody>
      ${plan.parts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${esc(f(p.length))}</td><td>${esc(f(p.width))}</td><td>${esc(f(p.thickness))}</td><td>${esc(p.note ?? '')}</td></tr>`).join('')}
    </tbody></table>
  </section>`;

  const order = cuttingOrder(sheetParts(plan.parts), metric ? 2440 / 25.4 : 96, metric ? 3.2 / 25.4 : 1 / 8);
  const cutting = `
  <section class="packet">
    <h2>Cutting order</h2>
    ${order.map(g => `
      <h3>${esc(f(g.thickness))} plywood — ${g.fenceSettings} fence and ${g.stopSettings} stop settings</h3>
      <ol>${g.rips.map(r => `<li><strong>Rip fence at ${esc(f(r.width))}</strong>: ${r.strips} strip${r.strips === 1 ? '' : 's'}
        <ul>${r.crosscuts.map(c => `<li>Stop at ${esc(f(c.length))}: ${c.qty} — ${esc(c.parts.join(', '))}</li>`).join('')}</ul></li>`).join('')}</ol>`).join('')}
  </section>`;

  const hw = `
  <section class="packet">
    <h2>Hardware${cost ? ' and cost' : ''}</h2>
    <table><thead><tr><th>Item</th><th>Buy</th><th>Notes</th></tr></thead><tbody>
      ${hardware.map(h => `<tr><td>${esc(h.name)}</td><td>${esc(quantity(h.qty, h.unit))}</td><td>${esc(h.note ?? '')}</td></tr>`).join('')}
    </tbody></table>
    ${cost ? `<table><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>
      ${cost.lines.map(l => `<tr><td>${esc(l.name)}${l.optional ? ' (optional)' : ''}</td><td>${esc(l.qtyLabel)}</td><td>${money(l.total)}</td></tr>`).join('')}
      <tr><th colspan="2">Estimated total</th><th>${money(cost.total)}</th></tr>
    </tbody></table>` : ''}
  </section>`;

  const jigList = `
  <section class="packet page-break">
    <h2>Shop jigs</h2>
    ${jigs.map(j => {
      const pieces = [j.face, ...(j.extraFaces ?? [])];
      return `<div class="jig">
        <img src="${svgUrl(partSvg(j.face, units))}" alt="">
        <div>
          <h3>${esc(j.title ?? j.face.piece)}</h3>
          ${j.make ? `<p class="summary">${esc(j.make)}</p>` : ''}
          <p>${pieces.map(p => `${esc(pieces.length > 1 ? `${p.piece}: ` : '')}${esc(f(p.length))} × ${esc(f(p.width))} × ${esc(f(p.thickness))}`).join('<br>')}</p>
          <ol>${j.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        </div>
      </div>`;
    }).join('')}
  </section>`;

  const prints: string[] = [];
  plan.inserts.forEach((layout, i) => {
    if (!layout?.gridfinity || layout.error) return;
    const gf = layout.gridfinity;
    const binCounts = new Map<string, number>();
    for (const p of layout.binPacking?.placements ?? []) {
      const key = `${Math.max(p.w, p.d)} × ${Math.min(p.w, p.d)} bin, ${p.u}u (${Math.max(p.w, p.d) * GF_PITCH} × ${Math.min(p.w, p.d) * GF_PITCH} × ${p.u * GF_UNIT} mm)`;
      binCounts.set(key, (binCounts.get(key) ?? 0) + plan.unitCount);
    }
    prints.push(`<li><strong>${esc(plan.drawers[i].label)}</strong>: baseplate ${gf.columns} × ${gf.rows} (${gf.tiles.map(t => `${t.count * plan.unitCount} × ${t.columns}×${t.rows} tile`).join(', ')})${
      binCounts.size ? `; bins: ${[...binCounts].map(([k, n]) => `${n} × ${esc(k)}`).join('; ')}` : ''}</li>`);
  });
  const printing = prints.length ? `
  <section class="packet">
    <h2>3D prints</h2>
    <ul>${prints.join('')}</ul>
  </section>` : '';

  return summary + cutList + cutting + hw + printing + jigList;
}

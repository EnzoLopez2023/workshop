import { useState, useEffect } from 'react';
import { Scissors, Plus, Trash2, AlertTriangle, AlertCircle, Download, Save } from 'lucide-react';
import type { CutListItem } from '../types/project';
import { parseInches, buildCutPieces, optimizeCuts } from '../lib/cutPlan';
import type { StockSheet, CutPlanResult, SheetLayout } from '../lib/cutPlan';
import CutPlanSheet, { buildColorMap, fmtDim, PALETTE } from './CutPlanSheet';
import { getCutPlanConfig, saveCutPlanConfig } from '../services/api';

interface StockRow {
  id: string;
  lengthStr: string;
  widthStr: string;
  thicknessStr: string;
  qtyStr: string;
  label: string;
}

interface Props {
  cutList: CutListItem[];
  projectId?: number;
}

const PRESETS = [
  { label: '+ 4×8 Sheet', length: '96', width: '48' },
  { label: '+ 4×10 Sheet', length: '120', width: '48' },
];

function makeRow(overrides?: Partial<StockRow>): StockRow {
  return { id: crypto.randomUUID(), lengthStr: '', widthStr: '', thicknessStr: '', qtyStr: '1', label: '', ...overrides };
}

function formatStockLabel(row: StockRow | undefined): string | undefined {
  if (!row) return undefined;
  const t = row.thicknessStr.trim();
  const l = row.label.trim();
  const thickPart = t ? (/["”“]\s*$/.test(t) ? t : `${t}"`) : '';
  const combined = [thickPart, l].filter(Boolean).join(' ');
  return combined || undefined;
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layoutToSvgBlock(
  layout: SheetLayout,
  colorMap: Map<string, string>,
  sheetNumber: number,
  totalSheets: number,
  stockLabel: string | undefined,
): string {
  const { sheetLength, sheetWidth, placed, wastePercent } = layout;
  const maxW = 900;
  const maxH = 504;
  const scale = Math.min(maxW / sheetLength, maxH / sheetWidth);
  const svgW = Math.round(sheetLength * scale);
  const svgH = Math.round(sheetWidth * scale);

  const titleParts = [
    `Sheet ${sheetNumber} of ${totalSheets}`,
    `${fmtDim(sheetLength)} × ${fmtDim(sheetWidth)}`,
    `Yield: ${(100 - wastePercent).toFixed(1)}%`,
    stockLabel,
  ].filter(Boolean).join('  ·  ');

  const piecesSvg = placed.map(p => {
    const fill = colorMap.get(p.partName) ?? PALETTE[0];
    const safeId = p.pieceId.replace(/[^a-z0-9]/gi, '_');
    const clipId = `pc${layout.sheetIndex}_${safeId}`;
    const pxW = p.length * scale;
    const pxH = p.width * scale;
    const showText = pxW >= 12 && pxH >= 12;
    const isPortrait = p.width > p.length;
    const cx = p.x + p.length / 2;
    const cy = p.y + p.width / 2;
    const textAvailPx = isPortrait ? pxH : pxW;
    const maxChars = Math.max(3, Math.floor(textAvailPx / 6.5));
    const label = p.partName.length > maxChars ? p.partName.slice(0, maxChars - 1) + '…' : p.partName;
    const dimLabel = `${fmtDim(p.length)} × ${fmtDim(p.width)}`;
    const showDims = Math.max(pxW, pxH) >= 40 && Math.min(pxW, pxH) >= 18;
    const shortSide = Math.min(p.length, p.width);
    const partFontSz = Math.min(9 / scale, shortSide * 0.25).toFixed(4);
    const dimFontSz  = Math.min(7 / scale, shortSide * 0.18).toFixed(4);
    const vOff = showDims ? p.width * 0.12 : 0;
    const sw = (1 / scale).toFixed(4);
    const rot = `rotate(-90,${cx},${cy})`;
    const rotAttr = isPortrait ? ` transform="${rot}"` : '';

    const textBlock = !showText ? '' : `
      <defs><clipPath id="${clipId}"><rect x="${p.x + 0.5}" y="${p.y + 0.5}" width="${p.length - 1}" height="${p.width - 1}"/></clipPath></defs>
      <g clip-path="url(#${clipId})">
        <text x="${cx}" y="${cy - vOff}" text-anchor="middle" dominant-baseline="middle" font-size="${partFontSz}" font-family="sans-serif" font-weight="600" fill="#1C0F07"${rotAttr}>${esc(label)}</text>
        ${showDims ? `<text x="${cx}" y="${cy + vOff}" text-anchor="middle" dominant-baseline="middle" font-size="${dimFontSz}" font-family="sans-serif" fill="rgba(28,15,7,0.55)"${rotAttr}>${esc(dimLabel)}</text>` : ''}
      </g>`;

    return `<g><rect x="${p.x}" y="${p.y}" width="${p.length}" height="${p.width}" fill="${fill}" stroke="rgba(0,0,0,0.22)" stroke-width="${sw}" rx="0.15"/>${textBlock}</g>`;
  }).join('');

  return `<div class="page">
  <p class="title">${esc(titleParts)}</p>
  <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${sheetLength} ${sheetWidth}">
    <rect x="0" y="0" width="${sheetLength}" height="${sheetWidth}" fill="#E8E2DC"/>
    ${piecesSvg}
    <rect x="0" y="0" width="${sheetLength}" height="${sheetWidth}" fill="none" stroke="#1C0F07" stroke-width="${(2 / scale).toFixed(4)}"/>
  </svg>
</div>`;
}

function buildPrintHtml(
  result: CutPlanResult,
  colorMap: Map<string, string>,
  stockRows: StockRow[],
): string {
  const stockLabel = (stockId: string) => formatStockLabel(stockRows.find(r => r.id === stockId));

  const pages = result.layouts.map(l =>
    layoutToSvgBlock(l, colorMap, l.sheetIndex + 1, result.totalSheets, stockLabel(l.stockId))
  ).join('\n');

  const legend = [...colorMap.entries()].map(([name, color]) =>
    `<span class="leg-item"><span class="swatch" style="background:${color}"></span>${esc(name)}</span>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cut Plan</title>
<style>
  @page { size: landscape; margin: 0.45in; }
  * { box-sizing: border-box; }
  body { font-family: sans-serif; font-size: 12px; color: #333; margin: 0; }
  .page { page-break-after: always; padding-bottom: 12px; }
  .page:last-of-type { page-break-after: avoid; }
  .title { margin: 0 0 7px; font-size: 12px; font-weight: 600; color: #555; }
  svg { display: block; border: 1.5px solid #bbb; border-radius: 3px; }
  .legend { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .leg-label { width: 100%; font-size: 9px; font-weight: 700; letter-spacing: .1em; color: #999; margin-bottom: 4px; }
  .leg-item { display: flex; align-items: center; gap: 5px; font-size: 10px; }
  .swatch { width: 11px; height: 11px; border-radius: 2px; border: 1px solid rgba(0,0,0,0.15); flex-shrink: 0; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head><body>
${pages}
<div class="page" style="page-break-after:avoid">
  <div class="legend"><div class="leg-label">LEGEND</div>${legend}</div>
</div>
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 300); });<\/script>
</body></html>`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CutPlanOptimizer({ cutList, projectId }: Props) {
  const [stockRows, setStockRows] = useState<StockRow[]>([makeRow()]);
  const [kerfStr, setKerfStr] = useState('0.125');
  const [result, setResult] = useState<CutPlanResult | null>(null);
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [hasSavedConfig, setHasSavedConfig] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    if (projectId == null) return;
    getCutPlanConfig(projectId)
      .then(({ config }) => {
        if (!config) return;
        const { stockRows: sr, kerfStr: ks } = config as { stockRows: StockRow[]; kerfStr: string };
        if (Array.isArray(sr) && sr.length > 0) {
          setStockRows(sr.map(r => ({ ...r, thicknessStr: r.thicknessStr || '' })));
          setHasSavedConfig(true);
        }
        if (typeof ks === 'string') setKerfStr(ks);
      })
      .catch(() => { /* no config saved yet */ });
  }, [projectId]);

  const updateRow = (id: string, patch: Partial<StockRow>) =>
    setStockRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const removeRow = (id: string) =>
    setStockRows(prev => prev.filter(r => r.id !== id));

  const addPreset = (length: string, width: string) =>
    setStockRows(prev => [...prev, makeRow({ lengthStr: length, widthStr: width })]);

  const saveConfig = () => {
    if (projectId == null) return;
    saveCutPlanConfig(projectId, { stockRows, kerfStr })
      .then(() => {
        setConfigSaved(true);
        setHasSavedConfig(true);
        setTimeout(() => setConfigSaved(false), 2000);
      })
      .catch(() => { /* ignore */ });
  };

  const handleGenerate = () => {
    setInputError(null);

    const stocks: StockSheet[] = [];
    for (const row of stockRows) {
      const l = parseInches(row.lengthStr);
      const w = parseInches(row.widthStr);
      const qty = parseInt(row.qtyStr, 10);
      if (l === null || w === null || isNaN(qty) || qty < 1) {
        setInputError('One or more stock rows have invalid dimensions or quantity.');
        return;
      }
      stocks.push({ id: row.id, length: l, width: w, qty, label: row.label.trim(), thickness: row.thicknessStr.trim() });
    }

    const kerf = parseFloat(kerfStr);
    if (isNaN(kerf) || kerf < 0) {
      setInputError('Kerf must be a non-negative number.');
      return;
    }

    const { pieces, skipped: sk } = buildCutPieces(cutList);
    setSkipped(sk);

    if (pieces.length === 0) {
      setInputError('No placeable pieces in the cut list — check that all pieces have valid length and width dimensions.');
      return;
    }

    const res = optimizeCuts(stocks, pieces, kerf);
    const cm = buildColorMap(res.layouts);
    setColorMap(cm);
    setResult(res);
    setShowAll(false);

    // Auto-save config
    if (projectId != null) {
      saveCutPlanConfig(projectId, { stockRows, kerfStr })
        .then(() => setHasSavedConfig(true))
        .catch(() => { /* ignore */ });
    }
  };

  const handleDownloadPdf = () => {
    if (!result) return;
    const html = buildPrintHtml(result, colorMap, stockRows);
    const win = window.open('', '_blank');
    if (!win) {
      setInputError('Pop-up blocked — please allow pop-ups and try again.');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const visibleLayouts = result
    ? (showAll ? result.layouts : result.layouts.slice(0, 6))
    : [];

  const stockForLayout = (stockId: string) =>
    stockRows.find(r => r.id === stockId);

  return (
    <div className="card" style={{ padding: '24px 28px' }}>
      {/* Stock input */}
      <div style={{
        backgroundColor: 'var(--color-cream-2)', borderRadius: 10,
        padding: '16px 18px', marginBottom: 16,
      }}>
        <div className="label-caps" style={{ marginBottom: 12 }}>
          AVAILABLE STOCK PANELS
        </div>

        <div className="cut-plan-table-wrap">
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 14px 1fr 14px 1fr 72px 1fr auto',
          gap: 6, alignItems: 'center',
          fontSize: '0.72rem', color: 'var(--color-muted)', fontWeight: 600,
          letterSpacing: '0.06em', marginBottom: 6, paddingRight: 32,
          minWidth: 560,
        }}>
          <span>LENGTH (in)</span>
          <span />
          <span>WIDTH (in)</span>
          <span />
          <span>THICKNESS</span>
          <span>QTY</span>
          <span>LABEL (optional)</span>
          <span />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stockRows.map(row => (
            <div key={row.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 14px 1fr 14px 1fr 72px 1fr auto',
              gap: 6, alignItems: 'center', minWidth: 560,
            }}>
              <input
                value={row.lengthStr}
                onChange={e => updateRow(row.id, { lengthStr: e.target.value })}
                placeholder="96"
              />
              <span style={{ textAlign: 'center', color: 'var(--color-muted)', fontWeight: 500 }}>×</span>
              <input
                value={row.widthStr}
                onChange={e => updateRow(row.id, { widthStr: e.target.value })}
                placeholder="48"
              />
              <span style={{ textAlign: 'center', color: 'var(--color-muted)', fontWeight: 500 }}>×</span>
              <input
                value={row.thicknessStr}
                onChange={e => updateRow(row.id, { thicknessStr: e.target.value })}
                placeholder="3/4"
              />
              <input
                type="number" min={1}
                value={row.qtyStr}
                onChange={e => updateRow(row.id, { qtyStr: e.target.value })}
                placeholder="1"
              />
              <input
                value={row.label}
                onChange={e => updateRow(row.id, { label: e.target.value })}
                placeholder="e.g. Plywood"
              />
              <button
                onClick={() => removeRow(row.id)}
                disabled={stockRows.length === 1}
                style={{
                  background: 'none', border: 'none', cursor: stockRows.length === 1 ? 'default' : 'pointer',
                  color: stockRows.length === 1 ? 'var(--color-line)' : 'var(--color-muted)',
                  padding: 4,
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        </div>{/* cut-plan-table-wrap */}

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={() => setStockRows(prev => [...prev, makeRow()])} style={{ fontSize: '0.8rem' }}>
            <Plus size={13} /> Add Row
          </button>
          {PRESETS.map(p => (
            <button
              key={p.label}
              className="chip"
              onClick={() => addPreset(p.length, p.width)}
              style={{ cursor: 'pointer', border: '1px dashed var(--color-line)', fontSize: '0.78rem' }}
            >
              {p.label}
            </button>
          ))}
          {hasSavedConfig && (
            <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginLeft: 'auto' }}>
              ✓ config loaded from last session
            </span>
          )}
        </div>
      </div>

      {/* Kerf + Generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--color-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Saw Kerf
          </label>
          <input
            type="number" min={0} max={0.5} step={0.0625}
            value={kerfStr}
            onChange={e => setKerfStr(e.target.value)}
            style={{ width: 76 }}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>inches</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {projectId != null && (
            <button className="btn btn-ghost" onClick={saveConfig} style={{ fontSize: '0.8rem' }}>
              <Save size={13} />
              {configSaved ? 'Saved!' : 'Save Config'}
            </button>
          )}
          <button className="btn btn-muted" onClick={handleGenerate}>
            <Scissors size={14} />
            Generate Cut Plan
          </button>
        </div>
      </div>

      {inputError && (
        <div style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--color-rust)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {inputError}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ marginTop: 28 }}>
          {/* Stats row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16, marginBottom: 20, paddingBottom: 20,
            borderBottom: '1px solid var(--color-line)',
          }}>
            <PlanStat label="Sheets Used"   value={String(result.totalSheets)} />
            <PlanStat label="Overall Yield" value={`${result.overallYieldPercent.toFixed(1)}%`} />
            <PlanStat label="Pieces Placed" value={String(result.layouts.reduce((s, l) => s + l.placed.length, 0))} />
            <PlanStat label="Total Cuts"    value={String(result.totalCuts)} />
          </div>

          {/* Warning banners */}
          {skipped.length > 0 && (
            <Banner color="#b07d2a" bg="#fdf6e8" icon={<AlertTriangle size={14} />}>
              <strong>{skipped.length} piece{skipped.length > 1 ? 's' : ''} skipped</strong> (missing dimensions):{' '}
              {[...new Set(skipped)].join(', ')}
            </Banner>
          )}
          {result.unplacedPieces.length > 0 && (
            <Banner color="var(--color-rust)" bg="#fdf0ec" icon={<AlertCircle size={14} />}>
              <strong>{result.unplacedPieces.length} piece{result.unplacedPieces.length > 1 ? 's' : ''} could not be placed</strong>{' '}
              (too large or no matching stock): {result.unplacedPieces.join(', ')}
            </Banner>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={handleDownloadPdf} style={{ fontSize: '0.82rem' }}>
              <Download size={14} />
              Download PDF
            </button>
          </div>

          {/* Sheet diagrams */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {visibleLayouts.map((layout) => {
              const stockRow = stockForLayout(layout.stockId);
              return (
                <div key={layout.sheetIndex} className="card" style={{ padding: '16px 20px' }}>
                  <CutPlanSheet
                    layout={layout}
                    sheetNumber={layout.sheetIndex + 1}
                    totalSheets={result.totalSheets}
                    colorMap={colorMap}
                    stockLabel={formatStockLabel(stockRow)}
                  />
                </div>
              );
            })}
          </div>

          {result.layouts.length > 6 && (
            <button
              className="btn btn-ghost"
              onClick={() => setShowAll(v => !v)}
              style={{ marginTop: 12, fontSize: '0.82rem' }}
            >
              {showAll ? 'Show fewer sheets' : `Show all ${result.layouts.length} sheets`}
            </button>
          )}

          {/* Color legend */}
          {colorMap.size > 0 && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)' }}>
              <div className="label-caps" style={{ marginBottom: 10 }}>LEGEND</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                {[...colorMap.entries()].map(([name, color]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: color, flexShrink: 0, border: '1px solid rgba(0,0,0,0.1)' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-ink)' }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Banner({ color, bg, icon, children }: { color: string; bg: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      backgroundColor: bg, border: `1px solid ${color}`,
      borderRadius: 8, padding: '10px 14px', marginBottom: 14,
      fontSize: '0.82rem', color,
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

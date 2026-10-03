import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Tooltip } from './Tooltip';
import { Scissors, Plus, Trash2, AlertTriangle, AlertCircle, Download, Save } from 'lucide-react';
import type { CutListItem } from '../types/project';
import { buildCutPieces, explainUnplaced, optimizeCuts, parseInches } from '../lib/cutPlan';
import type { UnplacedGroup } from '../lib/cutPlan';
import { decimalString, fmtMm, lengthToField, parseLength, type LengthUnit } from '../lib/shelving';
import { validateKerf, validateStockRows, type InputIssue, type StockField } from '../lib/cutPlanInput';
import type { StockSheet, CutPlanResult, SheetLayout } from '../lib/cutPlan';
import CutPlanSheet, { buildColorMap, fmtDim, PALETTE } from './CutPlanSheet';
import { getCutPlanConfig, saveCutPlanConfig } from '../services/api';
import { Button } from './ui';

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
  /** Unit for stock sizes, kerf, and displayed dimensions. Pieces are always inches. */
  units?: LengthUnit;
  /** Thickness (inches) new sheets start with; sheets still on it follow when it changes. */
  defaultThickness?: number;
}

const PRESETS: Record<LengthUnit, { label: string; length: string; width: string }[]> = {
  in: [
    { label: '+ 4×8 Sheet', length: '96', width: '48' },
    { label: '+ 4×10 Sheet', length: '120', width: '48' },
  ],
  mm: [
    { label: '+ 2440×1220 Sheet', length: '2440', width: '1220' },
    { label: '+ 3050×1220 Sheet', length: '3050', width: '1220' },
  ],
};

const DEFAULT_KERF: Record<LengthUnit, string> = { in: '0.125', mm: '3.2' };

function formatterFor(units: LengthUnit): (inches: number) => string {
  return units === 'mm' ? fmtMm : fmtDim;
}

/** Converts a typed size to the given unit, leaving text that isn't a length untouched. */
function convertField(value: string, from: LengthUnit, to: LengthUnit): string {
  if (value.trim() === '') return value;
  const inches = parseLength(value, from);
  return inches === null ? value : lengthToField(inches, to);
}

function makeRow(overrides?: Partial<StockRow>): StockRow {
  return { id: crypto.randomUUID(), lengthStr: '', widthStr: '', thicknessStr: '', qtyStr: '1', label: '', ...overrides };
}

function formatStockLabel(row: StockRow | undefined, units: LengthUnit): string | undefined {
  if (!row) return undefined;
  const t = row.thicknessStr.trim();
  const l = row.label.trim();
  const parsed = t ? parseLength(t, units) : null;
  const thickPart = parsed !== null ? formatterFor(units)(parsed) : t;
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
  fmtDim: (inches: number) => string,
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
        <text x="${cx}" y="${cy - vOff}" text-anchor="middle" dominant-baseline="middle" font-size="${partFontSz}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-weight="600" letter-spacing="0.02em" fill="#15332E"${rotAttr}>${esc(label)}</text>
        ${showDims ? `<text x="${cx}" y="${cy + vOff}" text-anchor="middle" dominant-baseline="middle" font-size="${dimFontSz}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" fill="#58716B"${rotAttr}>${esc(dimLabel)}</text>` : ''}
      </g>`;

    return `<g><rect x="${p.x}" y="${p.y}" width="${p.length}" height="${p.width}" fill="${fill}" stroke="#15332E" stroke-opacity="0.22" stroke-width="${sw}" rx="0.15"/>${textBlock}</g>`;
  }).join('');

  return `<div class="page">
  <p class="title">${esc(titleParts)}</p>
  <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${sheetLength} ${sheetWidth}">
    <rect x="0" y="0" width="${sheetLength}" height="${sheetWidth}" fill="#E0EBE7"/>
    ${piecesSvg}
    <rect x="0" y="0" width="${sheetLength}" height="${sheetWidth}" fill="none" stroke="#15332E" stroke-width="${(2 / scale).toFixed(4)}"/>
  </svg>
</div>`;
}

function buildPrintHtml(
  result: CutPlanResult,
  colorMap: Map<string, string>,
  stockRows: StockRow[],
  units: LengthUnit,
): string {
  const stockLabel = (stockId: string) => formatStockLabel(stockRows.find(r => r.id === stockId), units);

  const pages = result.layouts.map(l =>
    layoutToSvgBlock(l, colorMap, l.sheetIndex + 1, result.totalSheets, stockLabel(l.stockId), formatterFor(units))
  ).join('\n');

  const legend = [...colorMap.entries()].map(([name, color]) =>
    `<span class="leg-item"><span class="swatch" style="background:${color}"></span>${esc(name)}</span>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cut Plan</title>
<style>
  @page { size: landscape; margin: 0.45in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 1rem; color: #15332E; margin: 0; }
  .page { page-break-after: always; padding-bottom: 12px; }
  .page:last-of-type { page-break-after: avoid; }
  .title { margin: 0 0 7px; font-size: 1rem; font-weight: 700; color: #58716B; }
  svg { display: block; border: 1px solid #C9DAD5; border-radius: 10px; }
  .legend { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .leg-label { width: 100%; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.015em; color: #58716B; margin-bottom: 4px; }
  .leg-item { display: flex; align-items: center; gap: 5px; font-size: 0.88rem; }
  .swatch { width: 11px; height: 11px; border-radius: 10px; border: 1px solid #C9DAD5; flex-shrink: 0; }
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

export default function CutPlanOptimizer({ cutList, projectId, units = 'in', defaultThickness }: Props) {
  const thicknessField = () => (defaultThickness ? lengthToField(defaultThickness, units) : '');
  const [stockRows, setStockRows] = useState<StockRow[]>(() => [makeRow({ thicknessStr: thicknessField() })]);
  const [kerfStr, setKerfStr] = useState(DEFAULT_KERF[units]);
  const [result, setResult] = useState<CutPlanResult | null>(null);
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [inputError, setInputError] = useState<string | null>(null);
  const [issues, setIssues] = useState<InputIssue[]>([]);
  const [unplaced, setUnplaced] = useState<{ groups: UnplacedGroup[]; stocks: StockSheet[] }>({ groups: [], stocks: [] });
  const [showAll, setShowAll] = useState(false);
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
      .catch(error => {
        console.error('Cut plan config load failed', error);
        toast.error('Could not restore the saved cut plan setup');
      });
  }, [projectId]);

  // When the unit changes, rewrite what's already typed so it keeps its meaning.
  const previousUnits = useRef(units);
  useEffect(() => {
    const from = previousUnits.current;
    if (from === units) return;
    previousUnits.current = units;
    setStockRows(prev => prev.map(r => ({
      ...r,
      lengthStr: convertField(r.lengthStr, from, units),
      widthStr: convertField(r.widthStr, from, units),
      thicknessStr: convertField(r.thicknessStr, from, units),
    })));
    setKerfStr(prev => {
      const value = Number.parseFloat(prev);
      if (!Number.isFinite(value) || value < 0) return prev;
      const inches = from === 'mm' ? value / 25.4 : value;
      return units === 'mm' ? String(Math.round(inches * 25.4 * 100) / 100) : String(Number(inches.toFixed(4)));
    });
  }, [units]);

  // Sheets still showing the old design thickness follow a new one; typed-in ones stay.
  const previousThickness = useRef(defaultThickness);
  useEffect(() => {
    const from = previousThickness.current;
    previousThickness.current = defaultThickness;
    if (from === defaultThickness || !defaultThickness) return;
    setStockRows(prev => prev.map(r => {
      const text = r.thicknessStr.trim();
      const current = text ? parseLength(text, units) : null;
      const followsDesign = text === '' || (from !== undefined && current !== null && Math.abs(current - from) < 1e-4);
      return followsDesign ? { ...r, thicknessStr: lengthToField(defaultThickness, units) } : r;
    }));
    // Only the design thickness drives this; unit changes are converted separately above.
  }, [defaultThickness]);

  const formatDim = formatterFor(units);
  const unitLabel = units === 'mm' ? 'mm' : 'in';

  const FIELD_FOR: Record<keyof StockRow, StockField | null> = {
    id: null, lengthStr: 'length', widthStr: 'width', thicknessStr: 'thickness', qtyStr: 'qty', label: null,
  };

  const updateRow = (id: string, patch: Partial<StockRow>) => {
    // Editing a flagged box clears its flag; the rest stay until the next Generate.
    const index = stockRows.findIndex(r => r.id === id);
    const edited = Object.keys(patch).map(k => FIELD_FOR[k as keyof StockRow]).filter(Boolean);
    setIssues(prev => prev.filter(i => !(i.row === index && edited.includes(i.field))));
    setStockRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const hasIssue = (row: number | null, field: StockField) =>
    issues.some(i => i.row === row && i.field === field);
  const invalidProps = (row: number | null, field: StockField) =>
    hasIssue(row, field) ? { 'aria-invalid': true as const, 'aria-describedby': 'cut-plan-issues' } : {};

  const removeRow = (id: string) => {
    setIssues([]);
    setStockRows(prev => prev.filter(r => r.id !== id));
  };

  const addPreset = (length: string, width: string) =>
    setStockRows(prev => [...prev, makeRow({ lengthStr: length, widthStr: width, thicknessStr: thicknessField() })]);

  const saveConfig = () => {
    if (projectId == null) return;
    saveCutPlanConfig(projectId, { stockRows, kerfStr })
      .then(() => {
        setHasSavedConfig(true);
        toast.success('Cut plan config saved');
      })
      .catch(() => toast.error('Could not save config'));
  };

  const handleGenerate = () => {
    setInputError(null);

    const checked = validateStockRows(stockRows, units);
    const kerfCheck = validateKerf(kerfStr, units);
    const found = kerfCheck.issue ? [...checked.issues, kerfCheck.issue] : checked.issues;
    setIssues(found);
    if (found.length > 0 || kerfCheck.kerf === null) {
      setResult(null);
      return;
    }
    const kerf = kerfCheck.kerf;

    const stocks: StockSheet[] = checked.stocks.map(({ row: index, length, width, qty }) => {
      const row = stockRows[index];
      // The optimizer compares thickness in inches, so normalize anything that parses as a length.
      const thicknessIn = row.thicknessStr.trim() ? parseLength(row.thicknessStr, units) : null;
      const thickness = thicknessIn !== null ? decimalString(thicknessIn) : row.thicknessStr.trim();
      return { id: row.id, length, width, qty, label: row.label.trim(), thickness };
    });

    const { pieces, skipped: sk } = buildCutPieces(cutList);
    setSkipped(sk);

    if (pieces.length === 0) {
      setInputError('No placeable pieces in the cut list — check that all pieces have valid length and width dimensions.');
      return;
    }

    const res = optimizeCuts(stocks, pieces, kerf);
    setUnplaced({ groups: explainUnplaced(stocks, pieces, res.layouts), stocks });
    const cm = buildColorMap(res.layouts);
    setColorMap(cm);
    setResult(res);
    setShowAll(false);

    // Auto-save config
    if (projectId != null) {
      saveCutPlanConfig(projectId, { stockRows, kerfStr })
        .then(() => setHasSavedConfig(true))
        .catch(error => {
          console.error('Cut plan config auto-save failed', error);
          toast.error('Cut plan generated, but its setup could not be saved');
        });
    }
  };

  const handleDownloadPdf = () => {
    if (!result) return;
    const html = buildPrintHtml(result, colorMap, stockRows, units);
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Pop-up blocked — please allow pop-ups and try again.');
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
    <div className="cut-plan-workbench">
      {/* Stock input */}
      <section className="cut-plan-inputs" aria-labelledby="available-stock-title">
        <h3 id="available-stock-title">Available stock panels</h3>
        <p>Enter the real sheet sizes and quantities on hand. Fractions are preserved exactly.</p>

        <div className="cut-plan-table-wrap">
        <div className="cut-plan-stock-head" aria-hidden="true">
          <span>LENGTH ({unitLabel})</span>
          <span />
          <span>WIDTH ({unitLabel})</span>
          <span />
          <span>THICKNESS</span>
          <span>QTY</span>
          <span>LABEL (optional)</span>
          <span />
        </div>

        <div className="cut-plan-stock-rows">
          {stockRows.map((row, index) => (
            <div key={row.id} className="cut-plan-stock-row">
              <input
                value={row.lengthStr}
                onChange={e => updateRow(row.id, { lengthStr: e.target.value })}
                placeholder={units === 'mm' ? 'e.g. 2440' : 'e.g. 96'}
                {...invalidProps(index, 'length')}
                aria-label={units === 'mm' ? 'Stock length in millimeters' : 'Stock length in inches'}
              />
              <span style={{ textAlign: 'center', color: 'var(--color-muted)', fontWeight: 500 }}>×</span>
              <input
                value={row.widthStr}
                onChange={e => updateRow(row.id, { widthStr: e.target.value })}
                placeholder={units === 'mm' ? 'e.g. 1220' : 'e.g. 48'}
                {...invalidProps(index, 'width')}
                aria-label={units === 'mm' ? 'Stock width in millimeters' : 'Stock width in inches'}
              />
              <span style={{ textAlign: 'center', color: 'var(--color-muted)', fontWeight: 500 }}>×</span>
              <input
                value={row.thicknessStr}
                onChange={e => updateRow(row.id, { thicknessStr: e.target.value })}
                placeholder={units === 'mm' ? 'any, e.g. 18' : 'any, e.g. 3/4'}
                {...invalidProps(index, 'thickness')}
                aria-label="Stock thickness"
              />
              <input
                type="number" min={1}
                value={row.qtyStr}
                onChange={e => updateRow(row.id, { qtyStr: e.target.value })}
                placeholder="1"
                {...invalidProps(index, 'qty')}
                aria-label="Stock quantity"
              />
              <input
                value={row.label}
                onChange={e => updateRow(row.id, { label: e.target.value })}
                placeholder="e.g. Plywood"
                aria-label="Optional stock label"
              />
              <Button
                variant="ghost"
                onClick={() => removeRow(row.id)}
                disabled={stockRows.length === 1}
                aria-label="Remove stock row"
              >
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        </div>{/* cut-plan-table-wrap */}

        <div className="cut-plan-presets">
          <Button variant="ghost" onClick={() => setStockRows(prev => [...prev, makeRow({ thicknessStr: thicknessField() })])}>
            <Plus size={16} aria-hidden="true" /> Add stock
          </Button>
          {PRESETS[units].map(p => (
            <Button
              key={p.label}
              variant="secondary"
              onClick={() => addPreset(p.length, p.width)}
            >
              {p.label}
            </Button>
          ))}
          {hasSavedConfig && (
            <span className="cut-plan-saved">Saved setup restored</span>
          )}
        </div>
      </section>

      {/* Kerf + Generate */}
      <div className="cut-plan-actions">
        <div className="cut-plan-kerf">
          <Tooltip content={units === 'mm' ? 'Blade width lost per cut — typically 3.2 mm for a table saw' : 'Blade width lost per cut — typically 1/8" for a table saw'} placement="top">
            <label>
              Saw kerf
              <input
                type="number" min={0} max={units === 'mm' ? 12 : 0.5} step={units === 'mm' ? 0.1 : 0.0625}
                value={kerfStr}
                onChange={e => {
                  setKerfStr(e.target.value);
                  setIssues(prev => prev.filter(i => i.field !== 'kerf'));
                }}
                {...invalidProps(null, 'kerf')}
              />
              <span>{units === 'mm' ? 'mm' : 'inches'}</span>
            </label>
          </Tooltip>
        </div>
        <div className="cut-plan-action-buttons">
          {projectId != null && (
            <Button variant="ghost" onClick={saveConfig}>
              <Save size={16} aria-hidden="true" /> Save setup
            </Button>
          )}
          <Button variant="primary" onClick={handleGenerate}>
            <Scissors size={16} aria-hidden="true" /> Generate cut plan
          </Button>
        </div>
      </div>

      {inputError && (
        <div className="inline-error cut-plan-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          {inputError}
        </div>
      )}

      {issues.length > 0 && (
        <div className="inline-error cut-plan-error cut-plan-issues" role="alert" id="cut-plan-issues">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>
              {issues.length === 1 ? 'Fix this before generating:' : `Fix these ${issues.length} things before generating:`}
            </strong>
            <ul>
              {issues.map(issue => <li key={`${issue.row}-${issue.field}`}>{issue.message}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <section className="cut-plan-results" aria-labelledby="cut-plan-results-title">
          <h3 id="cut-plan-results-title">Optimized layout</h3>
          {/* Stats row */}
          <dl className="cut-plan-summary">
            <PlanStat label="Sheets Used"   value={String(result.totalSheets)} />
            <PlanStat label="Overall Yield" value={`${result.overallYieldPercent.toFixed(1)}%`} />
            <PlanStat label="Pieces Placed" value={String(result.layouts.reduce((s, l) => s + l.placed.length, 0))} />
            <PlanStat label="Total Cuts"    value={String(result.totalCuts)} />
          </dl>

          {/* Warning banners */}
          {skipped.length > 0 && (
            <Banner tone="warning" icon={<AlertTriangle size={16} />}>
              <strong>{skipped.length} piece{skipped.length > 1 ? 's' : ''} skipped</strong> (missing dimensions):{' '}
              {[...new Set(skipped)].join(', ')}
            </Banner>
          )}
          {unplaced.groups.map(group => (
            <Banner key={group.reason} tone="danger" icon={<AlertCircle size={16} />}>
              <UnplacedMessage group={group} stocks={unplaced.stocks} formatDim={formatDim} />
            </Banner>
          ))}

          {/* Action buttons */}
          <div className="cut-plan-export">
            <Button variant="ghost" onClick={handleDownloadPdf}>
              <Download size={16} aria-hidden="true" /> Print or save PDF
            </Button>
          </div>

          {/* Sheet diagrams */}
          <div className="cut-plan-sheets">
            {visibleLayouts.map((layout) => {
              const stockRow = stockForLayout(layout.stockId);
              return (
                <div key={layout.sheetIndex} className="cut-plan-sheet-card">
                  <CutPlanSheet
                    layout={layout}
                    sheetNumber={layout.sheetIndex + 1}
                    totalSheets={result.totalSheets}
                    colorMap={colorMap}
                    stockLabel={formatStockLabel(stockRow, units)}
                    formatDim={formatDim}
                  />
                </div>
              );
            })}
          </div>

          {result.layouts.length > 6 && (
            <Button
              variant="ghost"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? 'Show fewer sheets' : `Show all ${result.layouts.length} sheets`}
            </Button>
          )}

          {/* Color legend */}
          {colorMap.size > 0 && (
            <div className="cut-plan-legend">
              <h4>Part legend</h4>
              <div>
                {[...colorMap.entries()].map(([name, color]) => (
                  <div key={name}>
                    <span className="cut-plan-swatch" style={{ backgroundColor: color }} />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function UnplacedMessage({
  group, stocks, formatDim,
}: {
  group: UnplacedGroup;
  stocks: StockSheet[];
  formatDim: (inches: number) => string;
}) {
  const thick = (value: string) => {
    const inches = parseInches(value);
    return inches === null ? `"${value}"` : formatDim(inches);
  };
  const list = (items: string[]) => items.join(', ');
  const count = `${group.count} piece${group.count === 1 ? '' : 's'}`;
  const parts = <> ({list(group.parts)})</>;
  const sheetThicknesses = [...new Set(stocks.map(s => (s.thickness ? thick(s.thickness) : 'any')))];
  const labels = [...new Set(stocks.map(s => s.label).filter(Boolean))];

  switch (group.reason) {
    case 'thickness':
      return (
        <>
          <strong>{count} left off — no sheet is the right thickness.</strong>{' '}
          These parts are {list(group.thicknesses.map(thick))} thick{parts}, but your sheets are{' '}
          {list(sheetThicknesses)}. Change the sheet thickness to {list(group.thicknesses.map(thick))}, or leave
          Thickness blank to use a sheet for any part.
        </>
      );
    case 'material':
      return (
        <>
          <strong>{count} left off — no sheet label matches the material.</strong>{' '}
          These parts are {list(group.materials.map(m => `"${m}"`))}{parts}, and every word of a sheet's label must
          appear in a part's material; your labels are {list(labels.map(l => `"${l}"`))}. Clear the label, or use
          words from the material.
        </>
      );
    case 'too-large': {
      const sizes = [...new Set(stocks.map(s => `${formatDim(s.length)} × ${formatDim(s.width)}`))];
      const big = group.largest ? `${formatDim(group.largest.length)} × ${formatDim(group.largest.width)}` : '';
      return (
        <>
          <strong>{count} left off — bigger than every matching sheet.</strong>{' '}
          The largest is {big}{parts}; your matching sheets are {list(sizes)}. Add a bigger sheet, or split the part.
        </>
      );
    }
    case 'out-of-stock':
      return (
        <>
          <strong>{count} left off — ran out of sheets.</strong>{' '}
          Everything else fits, but the sheets you entered are all used{parts}. Raise the QTY or add another sheet.
        </>
      );
  }
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: 'warning' | 'danger'; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`cut-plan-banner cut-plan-banner-${tone}`} role="status">
      <span>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

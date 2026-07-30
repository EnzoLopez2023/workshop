import type { SheetLayout } from '../lib/cutPlan';

/* Lamp colours, not wood tones — each part reads as a lit cell on the board. */
export const PALETTE = [
  '#D69A2E', '#5590B5', '#5E9E72', '#C4776B', '#8A78B8',
  '#B8792C', '#3C7695', '#3F8A64', '#A85348', '#6E5F9E',
];

export function buildColorMap(layouts: SheetLayout[]): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  for (const layout of layouts) {
    for (const p of layout.placed) {
      if (!map.has(p.partName)) {
        map.set(p.partName, PALETTE[idx % PALETTE.length]);
        idx++;
      }
    }
  }
  return map;
}

export function fmtDim(inches: number): string {
  const whole = Math.floor(inches);
  const frac = inches - whole;
  if (frac < 0.01) return `${whole}"`;
  const FRACS: [number, string][] = [
    [0.125, '⅛'], [0.25, '¼'], [0.375, '⅜'], [0.5, '½'],
    [0.625, '⅝'], [0.75, '¾'], [0.875, '⅞'],
  ];
  const match = FRACS.find(([v]) => Math.abs(frac - v) < 0.04);
  if (match) return whole > 0 ? `${whole}${match[1]}"` : `${match[1]}"`;
  return `${inches.toFixed(2)}"`;
}

interface Props {
  layout: SheetLayout;
  sheetNumber: number;
  totalSheets: number;
  colorMap: Map<string, string>;
  stockLabel?: string;
}

export default function CutPlanSheet({ layout, sheetNumber, totalSheets, colorMap, stockLabel }: Props) {
  const { sheetLength, sheetWidth, placed, wastePercent } = layout;

  const maxPx = 740;
  const scale = Math.min(maxPx / sheetLength, 500 / sheetWidth);
  const svgW = sheetLength * scale;
  const svgH = sheetWidth * scale;

  const headerParts = [
    `Sheet ${sheetNumber} of ${totalSheets}`,
    `${fmtDim(sheetLength)} × ${fmtDim(sheetWidth)}`,
    `Yield: ${(100 - wastePercent).toFixed(1)}%`,
  ];
  if (stockLabel) headerParts.push(stockLabel);

  return (
    <div>
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 10, fontSize: '0.82rem', color: 'var(--color-muted)',
      }}>
        {headerParts.map((part, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
            <span style={{ color: i === 0 ? 'var(--color-ink)' : undefined, fontWeight: i === 0 ? 600 : undefined }}>
              {part}
            </span>
          </span>
        ))}
      </div>

      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${sheetLength} ${sheetWidth}`}
        style={{ display: 'block', borderRadius: 3, border: '1.5px solid var(--color-line)' }}
      >
        <rect x={0} y={0} width={sheetLength} height={sheetWidth} fill="#D5DBD8" />

        {placed.map((p) => {
          const fill = colorMap.get(p.partName) ?? PALETTE[0];
          const clipId = `clip-${layout.sheetIndex}-${p.pieceId}`;
          const pxW = p.length * scale;
          const pxH = p.width * scale;
          const showText = pxW >= 12 && pxH >= 12;

          // Rotate text for portrait pieces (taller than wide on screen)
          const isPortrait = p.width > p.length;
          const cx = p.x + p.length / 2;
          const cy = p.y + p.width / 2;

          // Available pixels along the text run direction
          const textAvailPx = isPortrait ? pxH : pxW;
          const maxChars = Math.max(3, Math.floor(textAvailPx / 6.5));
          const label = p.partName.length > maxChars ? p.partName.slice(0, maxChars - 1) + '…' : p.partName;
          const dimLabel = `${fmtDim(p.length)} × ${fmtDim(p.width)}`;

          const showDims = Math.max(pxW, pxH) >= 40 && Math.min(pxW, pxH) >= 18;

          // Target ~9px for name, ~7px for dims; cap at 25% / 18% of shorter side
          const shortSide = Math.min(p.length, p.width);
          const partFontSz = Math.min(9 / scale, shortSide * 0.25);
          const dimFontSz  = Math.min(7 / scale, shortSide * 0.18);

          // Vertical offset in SVG space; for portrait+rotation this becomes horizontal separation
          const vOff = showDims ? p.width * 0.12 : 0;
          const rot = `rotate(-90,${cx},${cy})`;

          return (
            <g key={p.pieceId}>
              <defs>
                <clipPath id={clipId}>
                  <rect x={p.x + 0.5} y={p.y + 0.5} width={p.length - 1} height={p.width - 1} />
                </clipPath>
              </defs>
              <rect
                x={p.x} y={p.y}
                width={p.length} height={p.width}
                fill={fill}
                stroke="rgba(0,0,0,0.22)"
                strokeWidth={1 / scale}
                rx={0.15}
              />
              {showText && (
                <g clipPath={`url(#${clipId})`}>
                  <text
                    x={cx} y={cy - vOff}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={partFontSz}
                    fontFamily="'Martian Mono', ui-monospace, monospace"
                    fontWeight="600"
                    letterSpacing="0.02em"
                    fill="#14181A"
                    transform={isPortrait ? rot : undefined}
                  >
                    {label}
                  </text>
                  {showDims && (
                    <text
                      x={cx} y={cy + vOff}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={dimFontSz}
                      fontFamily="'Martian Mono', ui-monospace, monospace"
                      fill="rgba(20,24,26,0.58)"
                      transform={isPortrait ? rot : undefined}
                    >
                      {dimLabel}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}

        <rect
          x={0} y={0}
          width={sheetLength} height={sheetWidth}
          fill="none"
          stroke="#14181A"
          strokeWidth={2 / scale}
        />
      </svg>
    </div>
  );
}

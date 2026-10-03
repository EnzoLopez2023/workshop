import type { SheetLayout } from '../lib/cutPlan';
import { PALETTE, fmtDim } from '../lib/cutPlan';

// Shared with the build guide's sheet drawings; re-exported for existing importers.
export { PALETTE, buildColorMap, fmtDim } from '../lib/cutPlan';

interface Props {
  layout: SheetLayout;
  sheetNumber: number;
  totalSheets: number;
  colorMap: Map<string, string>;
  stockLabel?: string;
  /** Formats an inch value for display; defaults to fractional inches. */
  formatDim?: (inches: number) => string;
}

export default function CutPlanSheet({ layout, sheetNumber, totalSheets, colorMap, stockLabel, formatDim = fmtDim }: Props) {
  const { sheetLength, sheetWidth, placed, wastePercent } = layout;

  const maxPx = 740;
  const scale = Math.min(maxPx / sheetLength, 500 / sheetWidth);
  const svgW = sheetLength * scale;
  const svgH = sheetWidth * scale;

  const headerParts = [
    `Sheet ${sheetNumber} of ${totalSheets}`,
    `${formatDim(sheetLength)} × ${formatDim(sheetWidth)}`,
    `Yield: ${(100 - wastePercent).toFixed(1)}%`,
  ];
  if (stockLabel) headerParts.push(stockLabel);

  return (
    <figure className="cut-plan-sheet">
      <figcaption>
        {headerParts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span aria-hidden="true">·</span>}
            <span>{part}</span>
          </span>
        ))}
      </figcaption>

      <div className="cut-plan-sheet-scroll">
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${sheetLength} ${sheetWidth}`}
          role="img"
          aria-label={`Optimized layout for sheet ${sheetNumber} of ${totalSheets}`}
        >
        <rect x={0} y={0} width={sheetLength} height={sheetWidth} fill="#E0EBE7" />

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
          const dimLabel = `${formatDim(p.length)} × ${formatDim(p.width)}`;

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
                stroke="#15332E"
                strokeOpacity={0.22}
                strokeWidth={1 / scale}
                rx={0.15}
              />
              {showText && (
                <g clipPath={`url(#${clipId})`}>
                  <text
                    x={cx} y={cy - vOff}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={partFontSz}
                    fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
                    fontWeight="600"
                    letterSpacing="0.02em"
                    fill="#15332E"
                    transform={isPortrait ? rot : undefined}
                  >
                    {label}
                  </text>
                  {showDims && (
                    <text
                      x={cx} y={cy + vOff}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={dimFontSz}
                      fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
                      fill="#58716B"
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
          stroke="#15332E"
          strokeWidth={2 / scale}
        />
        </svg>
      </div>
    </figure>
  );
}

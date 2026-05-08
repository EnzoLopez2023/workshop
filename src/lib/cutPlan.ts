import type { CutListItem } from '../types/project';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StockSheet {
  id: string;
  length: number;
  width: number;
  qty: number;
  label: string;
  thickness: string;
}

export interface CutPiece {
  id: string;
  partName: string;
  length: number;
  width: number;
  material: string;
  thickness: string;
}

export interface PlacedPiece {
  pieceId: string;
  partName: string;
  length: number;
  width: number;
  x: number;
  y: number;
}

export interface SheetLayout {
  sheetIndex: number;
  stockId: string;
  sheetLength: number;
  sheetWidth: number;
  placed: PlacedPiece[];
  wastePercent: number;
}

export interface CutPlanResult {
  layouts: SheetLayout[];
  totalSheets: number;
  overallYieldPercent: number;
  totalCuts: number;
  skippedPieces: string[];
  unplacedPieces: string[];
}

// ── Dimension parser ──────────────────────────────────────────────────────────

const VULGAR: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};
const VULGAR_PATTERN = '[½¼¾⅛⅜⅝⅞]';

export function parseInches(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  // Normalize smart quotes
  const s = raw.replace(/’/g, "'").replace(/‘/g, "'")
               .replace(/“/g, '"').replace(/”/g, '"')
               .replace(/''/g, '"').trim();
  if (s === '') return null;

  let m: RegExpMatchArray | null;

  // 1. Feet + inch + vulgar fraction: 1' 11½
  m = s.match(new RegExp(`^(\\d+)'\\s*(\\d+)\\s*(${VULGAR_PATTERN})`, 'u'));
  if (m) { const v = Number(m[1]) * 12 + Number(m[2]) + VULGAR[m[3]]; return v > 0 ? v : null; }

  // 2. Feet + inch + simple fraction: 1' 11 3/4
  m = s.match(/^(\d+)'\s*(\d+)\s+(\d+)\/(\d+)/);
  if (m) { const v = Number(m[1]) * 12 + Number(m[2]) + Number(m[3]) / Number(m[4]); return v > 0 ? v : null; }

  // 3. Feet + inches (decimal ok): 2' 8  or  2'8  or  2' 8.5
  m = s.match(/^(\d+)'\s*(\d+(?:\.\d+)?)/);
  if (m) { const v = Number(m[1]) * 12 + Number(m[2]); return v > 0 ? v : null; }

  // 4. Feet only: 2'
  m = s.match(/^(\d+)'\s*$/);
  if (m) { const v = Number(m[1]) * 12; return v > 0 ? v : null; }

  // 5. Whole + vulgar fraction: 27½  or  ½ alone
  m = s.match(new RegExp(`^(\\d+)?\\s*(${VULGAR_PATTERN})`, 'u'));
  if (m) { const v = (m[1] ? Number(m[1]) : 0) + VULGAR[m[2]]; return v > 0 ? v : null; }

  // 6. Whole + simple fraction: 27 1/2
  m = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (m) { const v = Number(m[1]) + Number(m[2]) / Number(m[3]); return v > 0 ? v : null; }

  // 7. Simple fraction alone: 3/4
  m = s.match(/^(\d+)\/(\d+)/);
  if (m) { const v = Number(m[1]) / Number(m[2]); return v > 0 ? v : null; }

  // 8. Decimal or integer (leading dot ok): 27.5  or  .5
  m = s.match(/^(\d*\.?\d+)/);
  if (m) { const v = Number(m[1]); return v > 0 ? v : null; }

  return null;
}

// ── Build cut pieces from project cut list ────────────────────────────────────

export function buildCutPieces(cutList: CutListItem[]): { pieces: CutPiece[]; skipped: string[] } {
  const pieces: CutPiece[] = [];
  const skipped: string[] = [];

  for (const item of cutList) {
    const l = parseInches(item.length);
    const w = parseInches(item.width);
    if (l === null || w === null) {
      skipped.push(item.part_name);
      continue;
    }
    const qty = Math.max(1, item.qty ?? 1);
    for (let i = 0; i < qty; i++) {
      pieces.push({
        id: `${item.id}-${i}`,
        partName: item.part_name,
        length: l,
        width: w,
        material: (item.material ?? '').toLowerCase(),
        thickness: (item.thickness ?? '').toLowerCase(),
      });
    }
  }

  return { pieces, skipped };
}

// ── Guillotine cut optimizer ──────────────────────────────────────────────────

interface FreeRect { x: number; y: number; w: number; h: number; }

interface OpenSheet {
  stockId: string;
  sheetLength: number;
  sheetWidth: number;
  placed: PlacedPiece[];
  freeRects: FreeRect[];
}

function normalizeMatchText(s: string): string {
  return s.toLowerCase().replace(/["”“]/g, '').replace(/\s+/g, ' ').trim();
}

function thicknessMatches(stockThickness: string, pieceThickness: string): boolean {
  if (stockThickness.trim() === '') return true;
  const stockT = parseInches(stockThickness);
  const pieceT = parseInches(pieceThickness);
  if (stockT !== null && pieceT !== null) return Math.abs(stockT - pieceT) < 0.005;
  // Fall back to normalized string contains when one side isn't numeric
  const sn = normalizeMatchText(stockThickness);
  const pn = normalizeMatchText(pieceThickness);
  return pn !== '' && pn.includes(sn);
}

function matchesMaterial(piece: CutPiece, stock: StockSheet): boolean {
  if (!thicknessMatches(stock.thickness, piece.thickness)) return false;

  const tokens = normalizeMatchText(stock.label).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeMatchText(`${piece.material} ${piece.thickness}`);
  if (haystack === '') return false;
  return tokens.every(t => haystack.includes(t));
}

// w maps to the x-axis (piece.length), h maps to the y-axis (piece.width).
// This matches the SVG viewBox: x=0..sheetLength, y=0..sheetWidth.
function bssfScore(pieceL: number, pieceW: number, rect: FreeRect): number | null {
  if (pieceL > rect.w || pieceW > rect.h) return null;
  const leftoverShort = Math.min(rect.w - pieceL, rect.h - pieceW);
  const leftoverLong  = Math.max(rect.w - pieceL, rect.h - pieceW);
  return leftoverShort * 1_000_000 + leftoverLong;
}

function guillotineSplit(rect: FreeRect, pieceL: number, pieceW: number, kerf: number): FreeRect[] {
  // rightoverW: horizontal space to the right of the piece (x-axis)
  // topoverH:   vertical space below the piece (y-axis)
  const rightoverW = rect.w - pieceL - kerf;
  const topoverH   = rect.h - pieceW - kerf;
  const result: FreeRect[] = [];

  if (rightoverW < topoverH) {
    // Narrower gap is to the right — split that side first (limited to piece height)
    if (rightoverW > 0) {
      result.push({ x: rect.x + pieceL + kerf, y: rect.y, w: rightoverW, h: pieceW });
    }
    // Full-width strip below
    if (topoverH > 0) {
      result.push({ x: rect.x, y: rect.y + pieceW + kerf, w: rect.w, h: topoverH });
    }
  } else {
    // Narrower gap is below — split that side first (limited to piece width)
    if (topoverH > 0) {
      result.push({ x: rect.x, y: rect.y + pieceW + kerf, w: pieceL, h: topoverH });
    }
    // Full-height strip to the right
    if (rightoverW > 0) {
      result.push({ x: rect.x + pieceL + kerf, y: rect.y, w: rightoverW, h: rect.h });
    }
  }

  return result;
}

export function optimizeCuts(
  stocks: StockSheet[],
  pieces: CutPiece[],
  kerf: number,
): CutPlanResult {
  // Track remaining qty per stock
  const remaining = new Map<string, number>(stocks.map(s => [s.id, s.qty]));
  const openSheets: OpenSheet[] = [];
  const unplacedPieces: string[] = [];

  // Sort pieces by area descending
  const sorted = [...pieces].sort((a, b) => b.length * b.width - a.length * a.width);

  for (const piece of sorted) {
    // Find best placement across all open sheets (try both orientations)
    let bestScore = Infinity;
    let bestSheet = -1;
    let bestRect  = -1;
    let bestRotated = false;

    for (let si = 0; si < openSheets.length; si++) {
      const sheet = openSheets[si];
      // Check material match against the stock this sheet came from
      const stock = stocks.find(s => s.id === sheet.stockId);
      if (!stock || !matchesMaterial(piece, stock)) continue;

      for (let ri = 0; ri < sheet.freeRects.length; ri++) {
        const rect = sheet.freeRects[ri];
        const score = bssfScore(piece.length, piece.width, rect);
        if (score !== null && score < bestScore) {
          bestScore = score; bestSheet = si; bestRect = ri; bestRotated = false;
        }
        if (piece.length !== piece.width) {
          const scoreR = bssfScore(piece.width, piece.length, rect);
          if (scoreR !== null && scoreR < bestScore) {
            bestScore = scoreR; bestSheet = si; bestRect = ri; bestRotated = true;
          }
        }
      }
    }

    if (bestSheet >= 0) {
      // Place in existing sheet
      placePiece(openSheets[bestSheet], bestRect, piece, kerf, bestRotated);
    } else {
      // Open a new sheet from available stock (check both orientations)
      const matchingStock = stocks.find(s => matchesMaterial(piece, s) &&
        (remaining.get(s.id) ?? 0) > 0 &&
        (
          (piece.length <= s.length && piece.width <= s.width) ||
          (piece.length !== piece.width && piece.width <= s.length && piece.length <= s.width)
        ));

      if (matchingStock) {
        remaining.set(matchingStock.id, (remaining.get(matchingStock.id) ?? 0) - 1);
        const newSheet: OpenSheet = {
          stockId: matchingStock.id,
          sheetLength: matchingStock.length,
          sheetWidth: matchingStock.width,
          placed: [],
          freeRects: [{ x: 0, y: 0, w: matchingStock.length, h: matchingStock.width }],
        };
        openSheets.push(newSheet);
        const lastIdx = openSheets.length - 1;
        const rect0 = newSheet.freeRects[0];
        const score  = bssfScore(piece.length, piece.width, rect0);
        const scoreR = piece.length !== piece.width ? bssfScore(piece.width, piece.length, rect0) : null;
        const rotated = scoreR !== null && (score === null || scoreR < score);
        if (score !== null || scoreR !== null) {
          placePiece(openSheets[lastIdx], 0, piece, kerf, rotated);
        } else {
          unplacedPieces.push(piece.partName);
        }
      } else {
        unplacedPieces.push(piece.partName);
      }
    }
  }

  // Build result layouts
  const layouts: SheetLayout[] = openSheets.map((sheet, i) => {
    const usedArea = sheet.placed.reduce((sum, p) => sum + p.length * p.width, 0);
    const totalArea = sheet.sheetLength * sheet.sheetWidth;
    const wastePercent = totalArea > 0 ? (1 - usedArea / totalArea) * 100 : 100;
    return {
      sheetIndex: i,
      stockId: sheet.stockId,
      sheetLength: sheet.sheetLength,
      sheetWidth: sheet.sheetWidth,
      placed: sheet.placed,
      wastePercent,
    };
  });

  const totalSheetArea = layouts.reduce((s, l) => s + l.sheetLength * l.sheetWidth, 0);
  const totalUsedArea  = layouts.reduce((s, l) => s + l.placed.reduce((a, p) => a + p.length * p.width, 0), 0);
  const overallYieldPercent = totalSheetArea > 0 ? (totalUsedArea / totalSheetArea) * 100 : 0;
  const totalPiecesPlaced = layouts.reduce((s, l) => s + l.placed.length, 0);

  return {
    layouts,
    totalSheets: layouts.length,
    overallYieldPercent,
    totalCuts: totalPiecesPlaced,
    skippedPieces: [],   // populated by buildCutPieces caller
    unplacedPieces: [...new Set(unplacedPieces)],
  };
}

function placePiece(sheet: OpenSheet, rectIdx: number, piece: CutPiece, kerf: number, rotated = false) {
  const rect = sheet.freeRects[rectIdx];
  const pl = rotated ? piece.width : piece.length;
  const pw = rotated ? piece.length : piece.width;
  sheet.placed.push({
    pieceId: piece.id,
    partName: piece.partName,
    length: pl,
    width: pw,
    x: rect.x,
    y: rect.y,
  });
  const newRects = guillotineSplit(rect, pl, pw, kerf);
  sheet.freeRects.splice(rectIdx, 1, ...newRects);
}

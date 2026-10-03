// Validation for the cut plan optimizer's stock rows and kerf. Every problem is
// reported with the row, the field, what was typed, and what would work.

import { MM_PER_INCH, parseLength, type LengthUnit } from './shelving.ts';

export interface StockRowInput {
  lengthStr: string;
  widthStr: string;
  thicknessStr: string;
  qtyStr: string;
  label: string;
}

export type StockField = 'length' | 'width' | 'thickness' | 'qty' | 'kerf';

export interface InputIssue {
  /** Index into the rows array; null for issues that aren't about one row (kerf, no rows). */
  row: number | null;
  field: StockField;
  message: string;
}

export interface ValidStock {
  row: number;
  length: number;
  width: number;
  qty: number;
}

/** Widest kerf we accept before assuming the wrong unit was typed. */
const MAX_KERF_IN = 0.5;

function lengthExample(units: LengthUnit, kind: 'length' | 'width'): string {
  if (units === 'mm') return kind === 'length' ? '2440, or 96" for inches' : '1220, or 48" for inches';
  return kind === 'length' ? '96 or 95 7/8, or 2440mm' : '48 or 47 3/4, or 1220mm';
}

/** A row with no size or label is untouched — thickness may be prefilled from the design. */
function isBlankRow(row: StockRowInput): boolean {
  return row.lengthStr.trim() === ''
    && row.widthStr.trim() === ''
    && row.label.trim() === ''
    && (row.qtyStr.trim() === '' || row.qtyStr.trim() === '1');
}

export function validateStockRows(rows: StockRowInput[], units: LengthUnit): { issues: InputIssue[]; stocks: ValidStock[] } {
  const issues: InputIssue[] = [];
  const stocks: ValidStock[] = [];
  const many = rows.length > 1;

  if (rows.every(isBlankRow)) {
    issues.push({
      row: rows.length > 0 ? 0 : null,
      field: 'length',
      message: 'Enter at least one sheet size. The grey numbers in an empty row are only examples, not values — '
        + `type a length and width, or use one of the sheet buttons below.`,
    });
    return { issues, stocks };
  }

  rows.forEach((row, index) => {
    if (isBlankRow(row)) return; // An untouched extra row is ignored.
    const where = many ? `Row ${index + 1}: ` : '';

    const measure = (raw: string, field: 'length' | 'width'): number | null => {
      const text = raw.trim();
      const name = field === 'length' ? 'Length' : 'Width';
      if (text === '') {
        issues.push({ row: index, field, message: `${where}${name} is empty. Enter it in ${units === 'mm' ? 'millimeters' : 'inches'}, e.g. ${lengthExample(units, field)}.` });
        return null;
      }
      const value = parseLength(text, units);
      if (value === null) {
        const zero = /^[0.,\s]+$/.test(text);
        issues.push({
          row: index,
          field,
          message: zero
            ? `${where}${name} must be greater than 0.`
            : `${where}${name} "${text}" isn't a measurement. Use e.g. ${lengthExample(units, field)}.`,
        });
      }
      return value;
    };

    const length = measure(row.lengthStr, 'length');
    const width = measure(row.widthStr, 'width');

    const thickness = row.thicknessStr.trim();
    if (thickness !== '' && /\d/.test(thickness) && parseLength(thickness, units) === null) {
      issues.push({
        row: index,
        field: 'thickness',
        message: `${where}Thickness "${thickness}" isn't a measurement. Use e.g. ${units === 'mm' ? '18 or 3/4"' : '3/4 or 18mm'}, or leave it blank to accept any thickness.`,
      });
    }

    const qtyText = row.qtyStr.trim();
    const qty = Number(qtyText);
    if (qtyText === '') {
      issues.push({ row: index, field: 'qty', message: `${where}Quantity is empty. Enter how many of these sheets you have (1 or more).` });
    } else if (!/^\d+$/.test(qtyText) || !Number.isInteger(qty) || qty < 1) {
      issues.push({ row: index, field: 'qty', message: `${where}Quantity "${qtyText}" must be a whole number of 1 or more.` });
    }

    if (length !== null && width !== null && issues.every(i => i.row !== index)) {
      stocks.push({ row: index, length, width, qty });
    }
  });

  return { issues, stocks };
}

/** Returns the kerf in inches, or an issue describing what's wrong with it. */
export function validateKerf(raw: string, units: LengthUnit): { kerf: number | null; issue: InputIssue | null } {
  const text = raw.trim();
  const unitName = units === 'mm' ? 'millimeters' : 'inches';
  const typical = units === 'mm' ? '3.2' : '0.125 (1/8")';
  const fail = (message: string) => ({ kerf: null, issue: { row: null, field: 'kerf' as const, message } });

  if (text === '') return fail(`Saw kerf is empty. Enter the blade width in ${unitName} — ${typical} is typical — or 0 to ignore it.`);
  const value = Number(text);
  if (!Number.isFinite(value)) return fail(`Saw kerf "${text}" isn't a number. Enter the blade width in ${unitName}, e.g. ${typical}.`);
  if (value < 0) return fail(`Saw kerf can't be negative. Enter the blade width in ${unitName}, e.g. ${typical}.`);
  const inches = units === 'mm' ? value / MM_PER_INCH : value;
  if (inches > MAX_KERF_IN) {
    const max = units === 'mm' ? `${(MAX_KERF_IN * MM_PER_INCH).toFixed(1)} mm` : `${MAX_KERF_IN}"`;
    return fail(`Saw kerf ${text} ${units === 'mm' ? 'mm' : 'in'} is wider than any saw blade (max ${max}). Check that it's in ${unitName}.`);
  }
  return { kerf: inches, issue: null };
}

export type ConversionUnit = 'mm' | 'in';
export type ConversionTab = 'mm-to-in' | 'in-to-mm' | 'frac-to-mm';

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function toFrac32(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return '0"';
  if (inches >= 1e9) return '—';
  const whole = Math.floor(inches);
  const frac = inches - whole;
  const numerator32 = Math.round(frac * 32);
  if (numerator32 >= 32) return `${whole + 1}"`;
  if (numerator32 === 0) return `${whole}"`;
  const divisor = gcd(numerator32, 32);
  const numerator = numerator32 / divisor;
  const denominator = 32 / divisor;
  return whole > 0 ? `${whole} ${numerator}/${denominator}"` : `${numerator}/${denominator}"`;
}

export function toFrac8Label(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  if (remainder === 0) return `${whole}"`;
  const divisor = gcd(remainder, 8);
  const numerator = remainder / divisor;
  const denominator = 8 / divisor;
  return whole > 0 ? `${whole} ${numerator}/${denominator}"` : `${numerator}/${denominator}"`;
}

export function parseConversionValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function convertMeasurement(value: string, unit: ConversionUnit) {
  const number = parseConversionValue(value);
  const millimeters = unit === 'mm' ? number : number * 25.4;
  const inches = unit === 'in' ? number : number / 25.4;
  return {
    number,
    millimeters,
    inches,
    fraction: toFrac32(inches),
  };
}

export const MM_TABLE = Array.from({ length: 100 }, (_, index) => {
  const millimeters = index + 1;
  const inches = millimeters / 25.4;
  return { millimeters, inches, fraction: toFrac32(inches) };
});

export const IN_TABLE = Array.from({ length: 96 }, (_, index) => {
  const inches = index + 1;
  return { inches, millimeters: inches * 25.4 };
});

export const FRAC_GROUPS = Array.from({ length: 48 }, (_, whole) =>
  Array.from({ length: 8 }, (_, eighth) => {
    const eighths = whole * 8 + eighth + 1;
    return {
      label: toFrac8Label(eighths),
      millimeters: +(eighths / 8 * 25.4).toFixed(3),
    };
  }),
);

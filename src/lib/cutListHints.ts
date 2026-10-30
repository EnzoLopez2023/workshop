// Shop hints for a part in the cut list: which way the grain runs and which face shows.
// Rules by part name, shared by the Shelf Builder and the Built-in Studio.

export interface PartHint {
  grain: string;
  face: string;
}

export function partHint(name: string): PartHint {
  const n = name.toLowerCase();
  if (/drawer front|^front/.test(n)) return { grain: 'Along the length, matching the fronts above and below', face: 'Best face out' };
  if (/box|bottom groove|drawer (back|side)/.test(n) && !/^bottom$/.test(n)) return { grain: 'Along the length', face: 'Best face in' };
  if (/door/.test(n)) return { grain: 'Along the length (vertical)', face: 'Best face out' };
  if (/side|divider|partition|panel/.test(n)) return { grain: 'Along the length (vertical)', face: 'Best face out' };
  if (/^back/.test(n)) return { grain: 'Along the length (vertical)', face: 'Best face in' };
  if (/top|counter/.test(n)) return { grain: 'Along the length', face: 'Best face up' };
  if (/shelf|bottom/.test(n)) return { grain: 'Along the length', face: 'Best face up' };
  if (/kick|plinth|rail|stile|frame/.test(n)) return { grain: 'Along the length', face: 'Best face out' };
  if (/cleat|spacer|nailer|ledger/.test(n)) return { grain: 'Along the length', face: '—' };
  return { grain: 'Along the length', face: '—' };
}

/** Rip order: group by plywood thickness, then widest first, so one fence setting cuts every part of a width. */
export function ripOrder<T extends { width: number; thickness: number; length: number }>(parts: T[]): T[] {
  return [...parts].sort((a, b) => b.thickness - a.thickness || b.width - a.width || b.length - a.length);
}

// Matching cut-list part names to the 3D solids they're made of, so a click in the tree,
// the cut list or the 3D view can select the same part everywhere.

/** "Shelf (bays 1, 3)" → [0, 2]; a name without bays → null (every bay). */
function baysOf(partName: string): number[] | null {
  const m = /\(bays? ([\d, ]+)\)/.exec(partName);
  return m ? m[1].split(',').map(x => Number(x.trim()) - 1) : null;
}

/** Whether a solid (by name) is one of the pieces of a cut-list part. */
export function solidIsPart(partName: string, solidName: string): boolean {
  const bays = baysOf(partName);
  const bay = /^Bay (\d+) /.exec(solidName);
  const inBays = !bays || !bay || bays.includes(Number(bay[1]) - 1);
  const base = partName.replace(/\s*\(.*\)$/, '');
  switch (base) {
    case 'Side': return /^(Left|Right) side$/.test(solidName);
    case 'Divider': return /^Divider \d+$/.test(solidName);
    case 'Shelf': return /^Bay \d+ shelf \d+$/.test(solidName) && inBays;
    case 'Adjustable shelf': return /^Bay \d+ adjustable shelf \d+$/.test(solidName) && inBays;
    case 'Back': return /^Back/.test(solidName);
    default: return solidName.toLowerCase() === base.toLowerCase() || solidName.toLowerCase().startsWith(`${base.toLowerCase()} `);
  }
}

/** The cut-list part a clicked solid belongs to, if any. */
export function partOfSolidName<T extends { name: string }>(parts: T[], solidName: string): T | undefined {
  return parts.find(p => solidIsPart(p.name, solidName));
}

/**
 * A looser match for designs whose solids are named per cabinet or drawer ("Cabinet 2 · Left side",
 * "Drawer 3 front"): every word of the part's name appears in the solid's, and drawer-box
 * parts only match parts that name the box.
 */
export function solidLooselyIsPart(partName: string, solidName: string): boolean {
  const words = partName.replace(/\s*\(.*\)$/, '').toLowerCase().split(/\s+/).filter(Boolean);
  const have = new Set(solidName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!words.every(w => have.has(w))) return false;
  return words.includes('box') || !have.has('box');
}

// The CNC & Shaper export panel shared by the Shelf Builder and Drawer Builder:
// whole-sheet files, any extra groups (like the shelf-pin jig), and a file per
// part face.

import { useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button, SegmentedControl } from './ui';
import type { GuideSheets } from '../lib/buildGuide';
import { fileName, partDxf, partSvg, sheetDxf, sheetSvg, type PartFace } from '../lib/shelfExport';
import { formatLength, type LengthUnit } from '../lib/shelving';
import {
  BENCHPILOT_REACH, DEFAULT_PASS_THROUGH_BIT, OTHER_FEED, PASS_THROUGH_BITS, passThroughStatus,
  type BenchPilotFeed, type BenchPilotMount, type PassThroughStatus,
} from '../lib/passThrough';

interface BenchPilotSettings {
  /** Split parts longer than the BenchPilot cut area for pass-through. */
  on: boolean;
  mount: BenchPilotMount;
  feed: BenchPilotFeed;
  /** Bit the split outline is offset for, in inches. */
  bit: number;
}

const BENCHPILOT_KEY = 'workshop.cncExport.benchPilot';
const DEFAULT_BENCHPILOT: BenchPilotSettings = { on: false, mount: 'workstation', feed: 'sideways', bit: DEFAULT_PASS_THROUGH_BIT };
const FEED_OPTIONS = [
  { value: 'sideways', label: 'Left to right' },
  { value: 'front-to-back', label: 'Front to back' },
] as const;
const MOUNT_OPTIONS = [
  { value: 'workstation', label: 'Workstation' },
  { value: 'bench', label: 'Bench' },
] as const;
const FEED_WORDS: Record<BenchPilotFeed, string> = { sideways: 'left to right', 'front-to-back': 'front to back' };

/** Rebuilt field by field: anything in storage may be from an older release. */
function readBenchPilot(): BenchPilotSettings {
  try {
    const s = JSON.parse(localStorage.getItem(BENCHPILOT_KEY) ?? '{}') as Partial<BenchPilotSettings>;
    return {
      on: s.on === true,
      mount: s.mount === 'bench' ? 'bench' : 'workstation',
      feed: s.feed === 'front-to-back' ? 'front-to-back' : 'sideways',
      bit: PASS_THROUGH_BITS.find(b => Math.abs(b.value - (s.bit ?? NaN)) < 1e-9)?.value ?? DEFAULT_BENCHPILOT.bit,
    };
  } catch {
    return DEFAULT_BENCHPILOT;
  }
}

function useBenchPilot() {
  const [settings, setSettings] = useState(readBenchPilot);
  useEffect(() => {
    try { localStorage.setItem(BENCHPILOT_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);
  return [settings, (patch: Partial<BenchPilotSettings>) => setSettings(current => ({ ...current, ...patch }))] as const;
}

/** Hands the browser a file to save. */
export function saveFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SVG_TYPE = 'image/svg+xml';
export const DXF_TYPE = 'application/dxf';

export const svgThumb = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface SheetGroup {
  /** Shown before "Sheet 1 of 2" when there's more than one thickness, e.g. 3/4". */
  label?: string;
  sheets: GuideSheets;
}

interface Props {
  faces: PartFace[];
  sheetGroups: SheetGroup[];
  units: LengthUnit;
  /** File-name prefix: "shelf", "drawer". */
  prefix: string;
  /** What gets cut on a face, e.g. "2 dados, 4 pin holes". */
  summary: (face: PartFace) => string;
  /** What the grey pockets are in this design. */
  pocketLegend: string;
  /** Shows the blue line key for layout lines as well as the sheet edge. */
  guideLegend?: string;
  /** Under the whole-sheet files, e.g. a note about parts that need flipping. */
  sheetNote?: ReactNode;
  /** Extra groups between the sheets and the single parts (e.g. a drilling jig). */
  children?: ReactNode;
}

export default function CncExport({ faces, sheetGroups, units, prefix, summary, pocketLegend, guideLegend, sheetNote, children }: Props) {
  const f = (inches: number) => formatLength(inches, units);
  const first = sheetGroups[0]?.sheets;
  const [bench, setBench] = useBenchPilot();
  const reach = BENCHPILOT_REACH[bench.mount];
  const statusText = (status: PassThroughStatus): string => {
    switch (status.kind) {
      case 'fits': return status.turned ? 'Fits the BenchPilot cut area turned a quarter.' : 'Fits the BenchPilot cut area.';
      case 'split': {
        const { plan } = status;
        const along = plan.axis === 'u' ? 'from the left of the drawing' : 'across the drawing';
        return `Pass-through in ${plan.windows.length} segments, fed ${FEED_WORDS[bench.feed]}: seams at ${plan.seams.map(f).join(', ')} ${along}.`;
      }
      case 'too-wide': return `Too wide to feed ${FEED_WORDS[bench.feed]}. Feed it ${FEED_WORDS[OTHER_FEED[bench.feed]]} instead.`;
      case 'shaped': return 'Larger than the cut area, and its shaped outline can’t be split. File is the whole part.';
      case 'too-big': return 'Larger than the BenchPilot cut area both ways. File is the whole part.';
    }
  };
  return (
    <div className="shelf-export">
      <ul className="shelf-export-legend" aria-label="What the colours mean">
        <li><span className="is-outside" aria-hidden="true" />Outside cut, full depth</li>
        <li><span className="is-pocket" aria-hidden="true" />{pocketLegend}</li>
        <li><span className="is-guide" aria-hidden="true" />{guideLegend ?? 'Guide (sheet edge)'}</li>
      </ul>

      <div className="shelf-export-group">
        <h3>Whole sheets <small>for a CNC router</small></h3>
        <p>
          Laid out like the sheet layout ({first?.sheetSize}, {first?.kerf} kerf), every part with its face-up joinery.
          DXF layers are named by cut and depth — <code>OUTSIDE_…</code>, <code>POCKET_…</code>, <code>DRILL_…</code> — to map to toolpaths.
        </p>
        <ul className="shelf-export-sheets">
          {sheetGroups.flatMap(group => group.sheets.layouts.map((layout, i) => {
            const title = `${group.label ? `${group.label} sheet` : 'Sheet'} ${i + 1} of ${group.sheets.layouts.length}`;
            const svg = sheetSvg(layout, faces, units, title);
            return (
              <li key={`${group.label ?? ''}-${layout.sheetIndex}`}>
                <img src={svgThumb(svg)} alt={`${title}: ${layout.placed.length} parts`} />
                <span>{title} · {layout.placed.length} parts</span>
                <span className="shelf-export-buttons">
                  <Button variant="ghost" onClick={() => saveFile(fileName(`${prefix} ${title}`, 'svg'), svg, SVG_TYPE)}>
                    <Download size={16} aria-hidden="true" /> SVG
                  </Button>
                  <Button variant="ghost" onClick={() => saveFile(fileName(`${prefix} ${title}`, 'dxf'), sheetDxf(layout, faces, units), DXF_TYPE)}>
                    <Download size={16} aria-hidden="true" /> DXF
                  </Button>
                </span>
              </li>
            );
          }))}
        </ul>
        {sheetNote}
      </div>

      {children}

      <div className="shelf-export-group">
        <h3>Single parts <small>for the Shaper Origin</small></h3>
        <p>One file per face to machine, at real size. Each says which way the part goes on the bench.</p>
        <div className="shelf-export-benchpilot">
          <label className="shelf-toggle">
            <input type="checkbox" checked={bench.on} onChange={e => setBench({ on: e.target.checked })} />
            <span>
              <span className="shelf-toggle-label">BenchPilot pass-through</span>
              <small>
                Parts longer than the cut area become one file cut in segments: tape and scan the whole board, cut what’s in reach,
                slide it along, cut the rest. The outline turns into open on-line cuts already offset for your bit.
              </small>
            </span>
          </label>
          {bench.on && (
            <div className="shelf-export-benchpilot-options">
              <div className="form-field">
                <span className="form-field-label">BenchPilot on the</span>
                <SegmentedControl label="BenchPilot mount" value={bench.mount} options={MOUNT_OPTIONS} onChange={mount => setBench({ mount })} />
                <small>Cut area about {f(reach.width)} × {f(reach.depth)}</small>
              </div>
              <div className="form-field">
                <span className="form-field-label">Feed long parts</span>
                <SegmentedControl label="Pass-through feed" value={bench.feed} options={FEED_OPTIONS} onChange={feed => setBench({ feed })} />
                <small>The file isn’t turned; turn it in Shaper Studio to match.</small>
              </div>
              <label className="form-field">
                <span className="form-field-label">Outline bit</span>
                <select value={bench.bit} onChange={e => setBench({ bit: Number(e.target.value) })}>
                  {PASS_THROUGH_BITS.map(b => <option key={b.label} value={b.value}>{b.label}</option>)}
                </select>
                <small>Cut the split outline with exactly this bit.</small>
              </label>
            </div>
          )}
        </div>
        <div className="shelf-table-scroll" tabIndex={0} aria-label="Part files">
          <table className="shelf-table shelf-export-table">
            <thead>
              <tr><th scope="col">Part</th><th scope="col">Size</th><th scope="col">Cuts</th><th scope="col">Files</th></tr>
            </thead>
            <tbody>
              {faces.map(face => {
                const status = bench.on ? passThroughStatus(face, reach, bench.bit, bench.feed) : null;
                const fileFace = status?.kind === 'split' ? status.face : face;
                const svg = partSvg(fileFace, units);
                // The split file's thin on-line outline vanishes at thumbnail size; show the part itself.
                const thumb = fileFace === face ? svg : partSvg(face, units);
                const label = face.face ? `${face.piece} — ${face.face}` : face.piece;
                const stem = `${prefix} ${label}${status?.kind === 'split' ? ' pass-through' : ''}`;
                return (
                  <tr key={face.id}>
                    <th scope="row">
                      <span className="shelf-export-part">
                        <img src={svgThumb(thumb)} alt="" />
                        <span>
                          {label}
                          {face.material === 'solid' && <span className="shelf-optional"> solid wood</span>}
                          <small>{face.orientation}</small>
                          {status && (
                            <small className={`shelf-export-pass is-${status.kind}`}>{statusText(status)}</small>
                          )}
                        </span>
                      </span>
                    </th>
                    <td>{f(face.length)} × {f(face.width)} × {f(face.thickness)}</td>
                    <td className="is-muted">{summary(face)}</td>
                    <td>
                      <span className="shelf-export-buttons">
                        <Button variant="ghost" onClick={() => saveFile(fileName(stem, 'svg'), svg, SVG_TYPE)} aria-label={`Download ${label} as SVG`}>
                          <Download size={16} aria-hidden="true" /> SVG
                        </Button>
                        <Button variant="ghost" onClick={() => saveFile(fileName(stem, 'dxf'), partDxf(fileFace, units), DXF_TYPE)} aria-label={`Download ${label} as DXF`}>
                          <Download size={16} aria-hidden="true" /> DXF
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

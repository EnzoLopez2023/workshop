// The CNC & Shaper export panel shared by the Shelf Builder and Drawer Builder:
// whole-sheet files, any extra groups (like the shelf-pin jig), and a file per
// part face.

import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';
import type { GuideSheets } from '../lib/buildGuide';
import { fileName, partDxf, partSvg, sheetDxf, sheetSvg, type PartFace } from '../lib/shelfExport';
import { formatLength, type LengthUnit } from '../lib/shelving';

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
        <div className="shelf-table-scroll" tabIndex={0} aria-label="Part files">
          <table className="shelf-table shelf-export-table">
            <thead>
              <tr><th scope="col">Part</th><th scope="col">Size</th><th scope="col">Cuts</th><th scope="col">Files</th></tr>
            </thead>
            <tbody>
              {faces.map(face => {
                const svg = partSvg(face, units);
                const label = face.face ? `${face.piece} — ${face.face}` : face.piece;
                return (
                  <tr key={face.id}>
                    <th scope="row">
                      <span className="shelf-export-part">
                        <img src={svgThumb(svg)} alt="" />
                        <span>
                          {label}
                          {face.material === 'solid' && <span className="shelf-optional"> solid wood</span>}
                          <small>{face.orientation}</small>
                        </span>
                      </span>
                    </th>
                    <td>{f(face.length)} × {f(face.width)} × {f(face.thickness)}</td>
                    <td className="is-muted">{summary(face)}</td>
                    <td>
                      <span className="shelf-export-buttons">
                        <Button variant="ghost" onClick={() => saveFile(fileName(`${prefix} ${label}`, 'svg'), svg, SVG_TYPE)} aria-label={`Download ${label} as SVG`}>
                          <Download size={16} aria-hidden="true" /> SVG
                        </Button>
                        <Button variant="ghost" onClick={() => saveFile(fileName(`${prefix} ${label}`, 'dxf'), partDxf(face, units), DXF_TYPE)} aria-label={`Download ${label} as DXF`}>
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

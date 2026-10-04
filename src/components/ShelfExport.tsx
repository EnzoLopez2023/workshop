import { useMemo } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { Button } from './ui';
import { planGuideSheets } from '../lib/buildGuide';
import {
  fileName, flipFaces, partDxf, partFaces, partSvg, sheetDxf, sheetSvg, type PartFace,
} from '../lib/shelfExport';
import { formatLength, type LengthUnit, type ShelfConfig, type ShelfPlan } from '../lib/shelving';

interface Props {
  plan: ShelfPlan;
  config: ShelfConfig;
  units: LengthUnit;
}

/** Hands the browser a file to save. */
function saveFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SVG_TYPE = 'image/svg+xml';
const DXF_TYPE = 'application/dxf';

const svgThumb = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function featureSummary(face: PartFace): string {
  if (face.features.length === 0) return 'Outline only';
  const count = (match: (label: string) => boolean) => face.features.filter(f => match(f.label)).length;
  const bits = [
    [count(l => l.includes('dado')), 'dado'],
    [count(l => l.startsWith('Back')), face.features.some(f => f.label === 'Back groove') ? 'groove' : 'rabbet'],
    [count(l => l === 'Shelf pin'), 'pin hole'],
    [count(l => l.startsWith('Hinge cup')), 'hinge cup'],
  ] as const;
  return bits.filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`).join(', ');
}

export default function ShelfExport({ plan, config, units }: Props) {
  const faces = useMemo(() => partFaces(plan, config), [plan, config]);
  const sheets = useMemo(() => planGuideSheets(plan, config, units), [plan, config, units]);
  const flips = flipFaces(faces);
  const f = (inches: number) => formatLength(inches, units);

  return (
    <div className="shelf-export">
      <ul className="shelf-export-legend" aria-label="What the colours mean">
        <li><span className="is-outside" aria-hidden="true" />Outside cut, full depth</li>
        <li><span className="is-pocket" aria-hidden="true" />Pocket — dados, rabbets, pin holes, hinge cups (depth in each file)</li>
        <li><span className="is-guide" aria-hidden="true" />Guide (sheet edge)</li>
      </ul>

      <div className="shelf-export-group">
        <h3>Whole sheets <small>for a CNC router</small></h3>
        <p>
          Laid out like the sheet layout ({sheets.sheetSize}, {sheets.kerf} kerf), every part with its face-up joinery.
          DXF layers are named by cut and depth — <code>OUTSIDE_…</code>, <code>POCKET_…</code>, <code>DRILL_…</code> — to map to toolpaths.
        </p>
        <ul className="shelf-export-sheets">
          {sheets.layouts.map((layout, i) => {
            const title = `Sheet ${i + 1} of ${sheets.layouts.length}`;
            const svg = sheetSvg(layout, faces, units, title);
            return (
              <li key={layout.sheetIndex}>
                <img src={svgThumb(svg)} alt={`${title}: ${layout.placed.length} parts`} />
                <span>{title} · {layout.placed.length} parts</span>
                <span className="shelf-export-buttons">
                  <Button variant="ghost" onClick={() => saveFile(fileName(`shelf ${title}`, 'svg'), svg, SVG_TYPE)}>
                    <Download size={16} aria-hidden="true" /> SVG
                  </Button>
                  <Button variant="ghost" onClick={() => saveFile(fileName(`shelf ${title}`, 'dxf'), sheetDxf(layout, faces, units), DXF_TYPE)}>
                    <Download size={16} aria-hidden="true" /> DXF
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        {flips.length > 0 && (
          <p className="shelf-export-note">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>
              {[...new Set(flips.map(x => x.piece))].join(', ')} {flips.length === 1 ? 'has' : 'have'} joinery on both faces.
              The sheet files cut the left face; flip the part and use its <strong>right face</strong> file below for the other side.
            </span>
          </p>
        )}
      </div>

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
                    <td className="is-muted">{featureSummary(face)}</td>
                    <td>
                      <span className="shelf-export-buttons">
                        <Button variant="ghost" onClick={() => saveFile(fileName(`shelf ${label}`, 'svg'), svg, SVG_TYPE)} aria-label={`Download ${label} as SVG`}>
                          <Download size={16} aria-hidden="true" /> SVG
                        </Button>
                        <Button variant="ghost" onClick={() => saveFile(fileName(`shelf ${label}`, 'dxf'), partDxf(face, units), DXF_TYPE)} aria-label={`Download ${label} as DXF`}>
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

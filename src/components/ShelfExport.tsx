import { useMemo } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { Button } from './ui';
import CncExport, { DXF_TYPE, saveFile, SVG_TYPE, svgThumb } from './CncExport';
import { planGuideSheets } from '../lib/buildGuide';
import { fileName, flipFaces, partFaces, pinJig, pinJigDxf, pinJigSvg, type PartFace } from '../lib/shelfExport';
import { formatLength, type LengthUnit, type ShelfConfig, type ShelfPlan } from '../lib/shelving';

interface Props {
  plan: ShelfPlan;
  config: ShelfConfig;
  units: LengthUnit;
}

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
  const jig = useMemo(() => pinJig(plan), [plan]);
  const f = (inches: number) => formatLength(inches, units);

  return (
    <CncExport
      faces={faces}
      sheetGroups={[{ sheets }]}
      units={units}
      prefix="shelf"
      summary={featureSummary}
      pocketLegend="Pocket — dados, rabbets, pin holes, hinge cups (depth in each file)"
      sheetNote={flips.length > 0 && (
        <p className="shelf-export-note">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            {[...new Set(flips.map(x => x.piece))].join(', ')} {flips.length === 1 ? 'has' : 'have'} joinery on both faces.
            The sheet files cut the left face; flip the part and use its <strong>right face</strong> file below for the other side.
          </span>
        </p>
      )}
    >
      {jig && (
        <div className="shelf-export-group">
          <h3>Shelf-pin drilling jig <small>cut once, drill every face</small></h3>
          <div className="shelf-export-jig">
            <img src={svgThumb(pinJigSvg(jig, units))} alt={`Jig with ${jig.holesPerColumn} holes in each of two columns`} />
            <div>
              <p>
                {f(jig.length)} × {f(jig.width)} from {f(jig.thickness)} MDF or plywood — {jig.holesPerColumn} holes in each of two columns,
                {' '}{config.pinSystem === 'metric' ? '32 mm' : f(1)} apart, {config.pinSystem === 'metric' ? '5 mm' : f(0.25)} through holes.
              </p>
              <ol className="shelf-export-steps">
                <li>Lay the jig on the panel with one long edge flush with the panel’s front edge.</li>
                <li>Butt one end against the top of the fixed shelf (or the bottom panel) at the bottom of the opening, and clamp it.</li>
                <li>Drill through the holes, counting the holes the build guide lists for that opening. The blue ticks mark every 5th hole.</li>
                <li>For the opposite face (the other side, or a divider’s other face), turn the jig over — it’s symmetric, so the columns line up the same.</li>
                {jig.staggered && <li>On a divider’s second face, slip a {f(jig.spacing / 2)} spacer between the jig and the shelf so the holes miss the ones from the other side.</li>}
              </ol>
              <span className="shelf-export-buttons">
                <Button variant="ghost" onClick={() => saveFile(fileName('shelf pin jig', 'svg'), pinJigSvg(jig, units), SVG_TYPE)}>
                  <Download size={16} aria-hidden="true" /> SVG
                </Button>
                <Button variant="ghost" onClick={() => saveFile(fileName('shelf pin jig', 'dxf'), pinJigDxf(jig, units), DXF_TYPE)}>
                  <Download size={16} aria-hidden="true" /> DXF
                </Button>
              </span>
            </div>
          </div>
        </div>
      )}

    </CncExport>
  );
}

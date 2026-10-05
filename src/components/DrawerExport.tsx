import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';
import CncExport, { DXF_TYPE, saveFile, SVG_TYPE, svgThumb } from './CncExport';
import { planSheetsByThickness } from '../lib/buildGuide';
import { drawerFeatureSummary, drawerJigs, drawerPartFaces } from '../lib/drawerExport';
import type { DrawerConfig, DrawerPlan } from '../lib/drawerUnit';
import { fileName, partDxf, partSvg } from '../lib/shelfExport';
import { baseplateStl, GF_PITCH } from '../lib/gridfinity';
import { formatLength, type LengthUnit } from '../lib/shelving';

interface Props {
  plan: DrawerPlan;
  config: DrawerConfig;
  units: LengthUnit;
}

export default function DrawerExport({ plan, config, units }: Props) {
  const f = (inches: number) => formatLength(inches, units);
  const faces = useMemo(() => drawerPartFaces(plan, config), [plan, config]);
  const groups = useMemo(
    () => planSheetsByThickness(plan.parts, units).map(g => ({ label: formatLength(g.thickness, units), sheets: g.sheets })),
    [plan, units],
  );
  // f only depends on units.
  const jigs = useMemo(() => drawerJigs(plan, config, f), [plan, config, units]);
  // Every Gridfinity tile size in the design, with how many to print (all units, all drawers).
  const tiles = useMemo(() => {
    const out: { columns: number; rows: number; count: number; drawers: number[] }[] = [];
    plan.inserts.forEach((layout, i) => {
      for (const t of layout?.gridfinity && !layout.error ? layout.gridfinity.tiles : []) {
        const found = out.find(x => x.columns === t.columns && x.rows === t.rows);
        if (found) { found.count += t.count * plan.unitCount; if (!found.drawers.includes(i + 1)) found.drawers.push(i + 1); }
        else out.push({ ...t, count: t.count * plan.unitCount, drawers: [i + 1] });
      }
    });
    return out;
  }, [plan]);

  return (
    <CncExport
      faces={faces}
      sheetGroups={groups}
      units={units}
      prefix="drawer"
      summary={drawerFeatureSummary}
      pocketLegend="Pocket — rabbets, bottom grooves, T-nut holes (depth in each file)"
      guideLegend="Guide, not cut — sheet edge, slide lines, caster plates, jig marks"
    >
      {tiles.length > 0 && (
        <div className="shelf-export-group">
          <h3>Gridfinity baseplates <small>STL, for your 3D printer</small></h3>
          <p>
            Open-bottom baseplates in tiles that fit your printer’s bed. Print them flat, no supports; lay the tiles side by side in
            the drawer, centred. Standard {GF_PITCH} mm Gridfinity bins drop straight in.
          </p>
          <ul className="drawer-gridfinity">
            {tiles.map(t => (
              <li key={`${t.columns}x${t.rows}`}>
                <strong>{t.columns} × {t.rows} tile</strong>
                <span className="is-muted"> {t.columns * GF_PITCH} × {t.rows * GF_PITCH} mm · print {t.count} · drawer{t.drawers.length === 1 ? '' : 's'} {t.drawers.join(', ')}</span>
                <Button
                  variant="ghost"
                  onClick={() => saveFile(`gridfinity-baseplate-${t.columns}x${t.rows}.stl`, baseplateStl(t.columns, t.rows), 'model/stl')}
                  aria-label={`Download the ${t.columns} by ${t.rows} baseplate STL`}
                >
                  <Download size={16} aria-hidden="true" /> STL
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="shelf-export-group">
        <h3>Shop jigs <small>make the build repeatable</small></h3>
        <p>Cut these once from offcuts; they make every front, box and slide land in the same place.</p>
        <ul className="drawer-jigs">
          {jigs.map(jig => {
            const svg = partSvg(jig.face, units);
            return (
              <li key={jig.face.id} className="shelf-export-jig">
                <img src={svgThumb(svg)} alt="" />
                <div>
                  <strong>{jig.face.piece}</strong>
                  <small className="is-muted"> {f(jig.face.length)} × {f(jig.face.width)} × {f(jig.face.thickness)}</small>
                  <ol className="shelf-export-steps">
                    {jig.steps.map(step => <li key={step}>{step}</li>)}
                  </ol>
                  <span className="shelf-export-buttons">
                    <Button variant="ghost" onClick={() => saveFile(fileName(`drawer ${jig.face.piece}`, 'svg'), svg, SVG_TYPE)} aria-label={`Download ${jig.face.piece} as SVG`}>
                      <Download size={16} aria-hidden="true" /> SVG
                    </Button>
                    <Button variant="ghost" onClick={() => saveFile(fileName(`drawer ${jig.face.piece}`, 'dxf'), partDxf(jig.face, units), DXF_TYPE)} aria-label={`Download ${jig.face.piece} as DXF`}>
                      <Download size={16} aria-hidden="true" /> DXF
                    </Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </CncExport>
  );
}

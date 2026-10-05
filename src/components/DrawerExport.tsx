import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';
import CncExport, { DXF_TYPE, saveFile, SVG_TYPE, svgThumb } from './CncExport';
import { planSheetsByThickness } from '../lib/buildGuide';
import { drawerFeatureSummary, drawerJigs, drawerPartFaces, JIG_STAGES } from '../lib/drawerExport';
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
    const out: { columns: number; rows: number; count: number; drawers: string[] }[] = [];
    plan.inserts.forEach((layout, i) => {
      const name = plan.drawers[i].label.toLowerCase();
      for (const t of layout?.gridfinity && !layout.error ? layout.gridfinity.tiles : []) {
        const found = out.find(x => x.columns === t.columns && x.rows === t.rows);
        if (found) { found.count += t.count * plan.unitCount; if (!found.drawers.includes(name)) found.drawers.push(name); }
        else out.push({ ...t, count: t.count * plan.unitCount, drawers: [name] });
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
                <span className="is-muted"> {t.columns * GF_PITCH} × {t.rows * GF_PITCH} mm · print {t.count} · for {t.drawers.join(', ')}</span>
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
        <p>Cut these once from offcuts, in the order you’ll need them. Each is sized from this design.</p>
        {JIG_STAGES.map(({ stage, title }) => {
          const list = jigs.filter(j => j.stage === stage);
          if (!list.length) return null;
          return (
            <section key={stage} className="drawer-jig-stage" aria-label={title}>
              <h4>{title}</h4>
              <ul className="drawer-jigs">
                {list.map(jig => {
                  const pieces = [jig.face, ...(jig.extraFaces ?? [])];
                  return (
                    <li key={jig.face.id} className="shelf-export-jig">
                      <img src={svgThumb(partSvg(jig.face, units))} alt="" />
                      <div>
                        <strong>{jig.title ?? jig.face.piece}</strong>
                        {jig.make && <small className="is-muted"> · {jig.make}</small>}
                        <ol className="shelf-export-steps">
                          {jig.steps.map(step => <li key={step}>{step}</li>)}
                        </ol>
                        <ul className="drawer-jig-pieces">
                          {pieces.map(piece => (
                            <li key={piece.id}>
                              <span>{pieces.length > 1 ? piece.piece : ''} {f(piece.length)} × {f(piece.width)} × {f(piece.thickness)}</span>
                              <span className="shelf-export-buttons">
                                <Button variant="ghost" onClick={() => saveFile(fileName(`drawer ${piece.piece}`, 'svg'), partSvg(piece, units), SVG_TYPE)} aria-label={`Download ${piece.piece} as SVG`}>
                                  <Download size={16} aria-hidden="true" /> SVG
                                </Button>
                                <Button variant="ghost" onClick={() => saveFile(fileName(`drawer ${piece.piece}`, 'dxf'), partDxf(piece, units), DXF_TYPE)} aria-label={`Download ${piece.piece} as DXF`}>
                                  <Download size={16} aria-hidden="true" /> DXF
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </CncExport>
  );
}

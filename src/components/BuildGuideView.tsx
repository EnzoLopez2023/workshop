import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lightbulb, Loader2, Printer, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { toast } from 'sonner';
import { guidePrintHtml, sheetLayoutDataUrl, type BuildGuide, type GuideSheets, type GuideStep } from '../lib/buildGuide';
import { formatLength, type LengthUnit, type SolidKind } from '../lib/shelving';

interface Props {
  guide: BuildGuide;
  /** The unit's envelope, for framing the illustrations. */
  width: number;
  height: number;
  depth: number;
  wallMounted: boolean;
  units: LengthUnit;
  /** Heading for the printed guide, e.g. the project name. */
  title: string;
  /** One line under the printed heading: sizes and materials. */
  subtitle: string;
  colors?: Partial<Record<SolidKind, number>>;
}

// Images are keyed by step id so a redraw in progress never shows a picture under the wrong step.
type Images = { state: 'idle' } | { state: 'drawing'; done: number; total: number } | { state: 'ready'; urls: Map<string, string> } | { state: 'error'; message: string };

/** Redraw this long after the last design change, so typing doesn't redraw on every key. */
const REDRAW_DELAY_MS = 700;

/** The illustrated, printable step list used by the Shelf Builder and the Drawer Builder. */
export default function BuildGuideView({ guide, width, height, depth, wallMounted, units, title, subtitle, colors }: Props) {
  const colorKey = JSON.stringify(colors ?? {});
  const [images, setImages] = useState<Images>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    const timer = window.setTimeout(async () => {
      const drawn = guide.steps.filter(s => s.scene !== null);
      setImages(prev => (prev.state === 'ready' ? prev : { state: 'drawing', done: 0, total: drawn.length }));
      try {
        const { renderGuideScenes } = await import('../lib/shelfRender');
        const urls = await renderGuideScenes({
          solids: guide.solids,
          scenes: drawn.map(s => s.scene!),
          width,
          height,
          depth,
          wallMounted,
          colors,
          signal,
          onProgress: (done, total) => {
            if (!signal.cancelled) setImages(prev => (prev.state === 'ready' ? prev : { state: 'drawing', done, total }));
          },
        });
        if (!signal.cancelled) setImages({ state: 'ready', urls: new Map(drawn.map((s, i) => [s.id, urls[i]])) });
      } catch (err) {
        console.error('Build guide drawing failed', err);
        if (!signal.cancelled) {
          setImages({
            state: 'error',
            message: 'The illustrations couldn’t be drawn — this browser may have 3D graphics (WebGL) turned off. The written steps below are complete.',
          });
        }
      }
    }, REDRAW_DELAY_MS);
    return () => {
      signal.cancelled = true;
      window.clearTimeout(timer);
    };
    // colorKey stands in for the colours object.
  }, [guide, width, height, depth, wallMounted, attempt, colorKey]);

  // A clean window with only the guide, like the sheet layout's "Print or save PDF".
  const printGuide = () => {
    const f = (inches: number) => formatLength(inches, units);
    const html = guidePrintHtml(guide, images.state === 'ready' ? images.urls : new Map(), title, subtitle, f);
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups for Workshop and try again.');
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="shelf-guide">
      <div className="shelf-guide-toolbar">
        <span className="shelf-guide-status" role="status" aria-live="polite">
          {images.state === 'drawing' && (
            <><Loader2 size={14} className="spin" aria-hidden="true" /> Drawing step {Math.min(images.done + 1, images.total)} of {images.total}…</>
          )}
          {images.state === 'ready' && `${guide.steps.length} steps · updates as you change the design`}
        </span>
        <Button variant="ghost" onClick={printGuide} disabled={images.state === 'drawing'}>
          <Printer size={16} aria-hidden="true" /> Print guide
        </Button>
      </div>

      {images.state === 'error' && (
        <p className="shelf-guide-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{images.message}</span>
          <Button variant="ghost" onClick={() => setAttempt(a => a + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </Button>
        </p>
      )}

      <ol className="shelf-guide-steps">
        {guide.steps.map((step, index) => {
          const url = images.state === 'ready' ? images.urls.get(step.id) : undefined;
          if (step.sheets) {
            return (
              <li key={step.id} className="shelf-guide-step is-sheets">
                <GuideStepBody step={step} index={index} />
                <SheetFigures sheets={step.sheets} units={units} />
              </li>
            );
          }
          const scene = step.scene!;
          return (
            <li key={step.id} className="shelf-guide-step">
              <figure className="shelf-guide-figure">
                {url ? (
                  <img
                    src={url}
                    alt={`Step ${index + 1}: ${step.title}.${step.id === 'dados' ? ' Dados are marked in red on each panel.' : scene.highlight.length ? ' Parts for this step are shown in blue.' : ''}`}
                  />
                ) : (
                  <div className="shelf-guide-placeholder" aria-hidden="true">
                    {images.state === 'error' ? 'No illustration' : <span className="skeleton" />}
                  </div>
                )}
                {scene.highlight.length > 0 && step.id !== 'cut' && (
                  <figcaption>
                    <span className={`shelf-guide-swatch ${step.id === 'dados' ? 'is-groove' : ''}`} aria-hidden="true" />
                    {step.id === 'dados' ? 'Dados to cut' : step.highlightCaption ?? 'Added in this step'}
                  </figcaption>
                )}
              </figure>

              <GuideStepBody step={step} index={index} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function GuideStepBody({ step, index }: { step: GuideStep; index: number }) {
  return (
    <div className="shelf-guide-body">
      <h3>
        <span className="shelf-guide-number" aria-hidden="true">{index + 1}</span>
        <span><span className="sr-only">Step {index + 1}: </span>{step.title}</span>
      </h3>
      <p className="shelf-guide-summary">{step.summary}</p>

      {step.instructions.length > 0 && (
        <ol className="shelf-guide-instructions">
          {step.instructions.map(line => <li key={line}>{line}</li>)}
        </ol>
      )}

      {step.parts.length > 0 && (
        <table className="shelf-guide-parts">
          <caption className="sr-only">Parts for step {index + 1}</caption>
          <thead>
            <tr><th scope="col">Part</th><th scope="col">Qty</th><th scope="col">Size</th></tr>
          </thead>
          <tbody>
            {step.parts.map(p => (
              <tr key={p.name}><th scope="row">{p.name}</th><td>{p.qty}</td><td>{p.size}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      {step.cautions.map(c => (
        <p key={c} className="shelf-guide-note is-caution"><AlertTriangle size={15} aria-hidden="true" /> <span>{c}</span></p>
      ))}
      {step.tips.map(tip => (
        <p key={tip} className="shelf-guide-note"><Lightbulb size={15} aria-hidden="true" /> <span>{tip}</span></p>
      ))}
    </div>
  );
}

function SheetFigures({ sheets, units }: { sheets: GuideSheets; units: LengthUnit }) {
  const f = (inches: number) => formatLength(inches, units);
  const urls = useMemo(
    () => sheets.layouts.map(layout => sheetLayoutDataUrl(layout, sheets.colors, f)),
    // f only depends on units.
    [sheets, units],
  );
  return (
    <div className="shelf-guide-sheets">
      <div className="shelf-guide-sheet-grid">
        {sheets.layouts.map((layout, i) => (
          <figure key={layout.sheetIndex}>
            <img src={urls[i]} alt={`Sheet ${i + 1} of ${sheets.layouts.length}: ${layout.placed.map(p => p.partName).join(', ')}`} />
            <figcaption>Sheet {i + 1} of {sheets.layouts.length} · {(100 - layout.wastePercent).toFixed(0)}% used</figcaption>
          </figure>
        ))}
      </div>
      <ul className="shelf-guide-legend" aria-label="Part colours">
        {[...sheets.colors.entries()].map(([name, color]) => (
          <li key={name}><span style={{ background: color }} aria-hidden="true" />{name}</li>
        ))}
      </ul>
    </div>
  );
}

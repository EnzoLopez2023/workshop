import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Lightbulb, Loader2, Printer, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { buildGuideSteps } from '../lib/buildGuide';
import type { LengthUnit, ShelfConfig, ShelfPlan } from '../lib/shelving';

interface Props {
  plan: ShelfPlan;
  config: ShelfConfig;
  units: LengthUnit;
}

// Images are keyed by step id so a redraw in progress never shows a picture under the wrong step.
type Images = { state: 'idle' } | { state: 'drawing'; done: number; total: number } | { state: 'ready'; urls: Map<string, string> } | { state: 'error'; message: string };

/** Redraw this long after the last design change, so typing doesn't redraw on every key. */
const REDRAW_DELAY_MS = 700;

export default function ShelfBuildGuide({ plan, config, units }: Props) {
  const guide = useMemo(() => buildGuideSteps(plan, config, units), [plan, config, units]);
  const [images, setImages] = useState<Images>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    const timer = window.setTimeout(async () => {
      setImages(prev => (prev.state === 'ready' ? prev : { state: 'drawing', done: 0, total: guide.steps.length }));
      try {
        const { renderGuideScenes } = await import('../lib/shelfRender');
        const urls = await renderGuideScenes({
          solids: guide.solids,
          scenes: guide.steps.map(s => s.scene),
          width: plan.overallWidth,
          height: plan.overallHeight,
          depth: plan.sideDepth,
          wallMounted: config.mounting === 'wall',
          signal,
          onProgress: (done, total) => {
            if (!signal.cancelled) setImages(prev => (prev.state === 'ready' ? prev : { state: 'drawing', done, total }));
          },
        });
        if (!signal.cancelled) setImages({ state: 'ready', urls: new Map(guide.steps.map((s, i) => [s.id, urls[i]])) });
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
  }, [guide, plan, config.mounting, attempt]);

  const printGuide = () => {
    document.body.classList.add('print-shelf-guide');
    const done = () => {
      document.body.classList.remove('print-shelf-guide');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
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
          return (
            <li key={step.id} className="shelf-guide-step">
              <figure className="shelf-guide-figure">
                {url ? (
                  <img
                    src={url}
                    alt={`Step ${index + 1}: ${step.title}.${step.id === 'dados' ? ' Dados are marked in red on each panel.' : step.scene.highlight.length ? ' Parts added in this step are shown in blue.' : ''}`}
                  />
                ) : (
                  <div className="shelf-guide-placeholder" aria-hidden="true">
                    {images.state === 'error' ? 'No illustration' : <span className="skeleton" />}
                  </div>
                )}
                {step.scene.highlight.length > 0 && step.id !== 'cut' && (
                  <figcaption>
                    <span className={`shelf-guide-swatch ${step.id === 'dados' ? 'is-groove' : ''}`} aria-hidden="true" />
                    {step.id === 'dados' ? 'Dados to cut' : 'Added in this step'}
                  </figcaption>
                )}
              </figure>

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
            </li>
          );
        })}
      </ol>
    </div>
  );
}

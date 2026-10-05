// Guided tours: a spotlight on one part of the page at a time, with a card that
// explains it. Tours can move between pages (each step names its route and the
// tour waits for its target to appear) and some steps are hands-on: "Try it"
// steps advance when you click the highlighted control.
//
// The page stays usable underneath — nothing is blocked — so a tour never traps
// you; Esc or "End tour" closes it at any point.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { TOURS, type TourId, type TourStep } from './tours';

interface TourApi {
  start: (id: TourId) => void;
  /** The tour that's running, if any. */
  active: TourId | null;
}

const TourContext = createContext<TourApi>({ start: () => undefined, active: null });

export const useTour = () => useContext(TourContext);

const SEEN_KEY = 'workshop-tours-seen';

/** Tours this browser has finished or dismissed (so first-visit offers don't repeat). */
export function toursSeen(): TourId[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as TourId[]; } catch { return []; }
}

export function markTourSeen(id: TourId) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...toursSeen(), id])])); } catch { /* convenience only */ }
}

/** The first visible element for a selector (the sidebar and phone nav both carry the same tour marks). */
function findTarget(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<TourId | null>(null);
  const [index, setIndex] = useState(0);
  const start = useCallback((id: TourId) => { setIndex(0); setActive(id); }, []);
  const close = useCallback(() => {
    if (active) markTourSeen(active);
    setActive(null);
  }, [active]);

  // "Start the … tutorial" links inside a tour hand over to another tour.
  useEffect(() => {
    const onStart = (e: Event) => start((e as CustomEvent<TourId>).detail);
    window.addEventListener('workshop:tour', onStart);
    return () => window.removeEventListener('workshop:tour', onStart);
  }, [start]);

  const api = useMemo(() => ({ start, active }), [start, active]);
  const steps = active ? TOURS[active].steps : [];
  return (
    <TourContext.Provider value={api}>
      {children}
      {active && steps[index] && (
        <TourStepView
          key={`${active}-${index}`}
          tour={active}
          step={steps[index]}
          index={index}
          count={steps.length}
          onBack={() => setIndex(i => Math.max(0, i - 1))}
          onNext={() => (index + 1 < steps.length ? setIndex(index + 1) : close())}
          onClose={close}
          onStart={start}
        />
      )}
    </TourContext.Provider>
  );
}

interface StepProps {
  tour: TourId;
  step: TourStep;
  index: number;
  count: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onStart: (id: TourId) => void;
}

function TourStepView({ tour, step, index, count, onBack, onNext, onClose, onStart }: StepProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [missing, setMissing] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });

  // Go to the step's page, run its setup, then wait (briefly) for its target.
  useEffect(() => {
    if (step.route && pathname !== step.route) {
      navigate(step.route);
      return;
    }
    step.before?.();
    if (!step.target) { setTarget(null); setMissing(false); return; }
    let tries = 0;
    let timer = 0;
    const look = () => {
      const el = findTarget(step.target);
      if (el) {
        setTarget(el);
        setMissing(false);
        el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      } else if (tries++ < 30) {
        timer = window.setTimeout(look, 100);
      } else {
        setMissing(true);
      }
    };
    look();
    return () => window.clearTimeout(timer);
    // The step object is stable per step; route changes re-run this.
  }, [step, pathname, navigate]);

  // Follow the target as the page scrolls, resizes or re-renders.
  useEffect(() => {
    if (!target) { setRect(null); return; }
    let frame = 0;
    const update = () => {
      frame = 0;
      setRect(target.isConnected ? target.getBoundingClientRect() : null);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    const interval = window.setInterval(schedule, 400);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, [target]);

  // Hands-on steps: clicking the highlighted control moves the tour on.
  useEffect(() => {
    if (!target || step.action !== 'click') return;
    const go = () => window.setTimeout(onNext, step.advanceDelay ?? 350);
    target.addEventListener('click', go, { once: true });
    return () => target.removeEventListener('click', go);
  }, [target, step, onNext]);

  // Keyboard: Esc ends, arrows step (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape') onClose();
      else if (!typing && e.key === 'ArrowRight' && step.action !== 'click') onNext();
      else if (!typing && e.key === 'ArrowLeft' && index > 0) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onBack, index, step]);

  useLayoutEffect(() => {
    const el = card.current;
    if (el) setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    el?.focus({ preventScroll: true });
  }, [step, missing]);

  // Card beside the target: below if there's room, else above, else centred.
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 640;
  let style: React.CSSProperties;
  if (phone || !rect) {
    // On a phone the card spans the width — at the bottom, unless that's where the target is.
    style = phone
      ? (rect && rect.top + rect.height / 2 > vh / 2 ? { left: 12, right: 12, top: 64 } : { left: 12, right: 12, bottom: 12 })
      : { left: (vw - cardSize.w) / 2, top: Math.max(16, (vh - cardSize.h) / 2) };
  } else {
    const left = Math.min(Math.max(12, rect.left), vw - cardSize.w - 12);
    const below = rect.bottom + pad + 12;
    const above = rect.top - pad - 12 - cardSize.h;
    const top = below + cardSize.h < vh ? below : above > 0 ? above : Math.max(12, vh - cardSize.h - 12);
    style = { left, top };
  }

  const last = index + 1 === count;
  return createPortal(
    <div className="tour-layer">
      {rect && (
        <div
          className={`tour-spotlight${step.action === 'click' ? ' is-action' : ''}`}
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          aria-hidden="true"
        />
      )}
      {!rect && <div className="tour-scrim" aria-hidden="true" />}
      <div
        ref={card}
        className="tour-card"
        style={style}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        <div className="tour-card-head">
          <span className="tour-count">{TOURS[tour].title} · {index + 1} of {count}</span>
          <button type="button" className="tour-close" onClick={onClose} aria-label="End tour"><X size={16} aria-hidden="true" /></button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <div id="tour-body" className="tour-body">
          {step.body.map(p => <p key={p}>{p}</p>)}
          {step.action === 'click' && rect && <p className="tour-try">Try it: {step.actionHint ?? 'click the highlighted control'}.</p>}
          {missing && <p className="tour-missing">This part isn’t on screen right now{step.missingHint ? ` — ${step.missingHint}` : ''}. You can skip ahead.</p>}
        </div>
        <progress className="tour-progress" max={count} value={index + 1} aria-hidden="true" />
        <div className="tour-actions">
          {index > 0 && <button type="button" className="tour-button" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Back</button>}
          <span className="tour-spacer" />
          {step.links?.map(l => (
            <button key={l.tour} type="button" className="tour-button" onClick={() => onStart(l.tour)}>{l.label}</button>
          ))}
          <button type="button" className="tour-button is-primary" onClick={onNext}>
            {last ? 'Finish' : step.action === 'click' && rect ? 'Skip' : 'Next'} {!last && <ArrowRight size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

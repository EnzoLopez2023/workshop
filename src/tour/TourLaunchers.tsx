import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Compass, HelpCircle, X } from 'lucide-react';
import { markTourSeen, toursSeen, useTour } from './Tour';
import { TOURS, type TourId } from './tours';

/** The tours, from the sidebar (or the phone header). */
export function HelpMenu({ compact = false }: { compact?: boolean }) {
  const { start } = useTour();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (id: TourId) => { setOpen(false); start(id); };
  return (
    <div className={`tour-help${compact ? ' is-compact' : ''}`} ref={wrap}>
      <button
        type="button"
        className={compact ? 'icon-button' : undefined}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={compact ? 'Help and tours' : undefined}
        title={compact ? 'Help and tours' : undefined}
        data-tour="help"
      >
        <HelpCircle size={compact ? 19 : 17} aria-hidden="true" />
        {!compact && <span>Help &amp; tours</span>}
      </button>
      {open && (
        <div className="tour-help-menu" role="menu">
          {(Object.keys(TOURS) as TourId[]).map(id => (
            <button key={id} type="button" role="menuitem" onClick={() => pick(id)}>
              <Compass size={16} aria-hidden="true" />
              <span>
                <strong>{TOURS[id].title}</strong>
                <small>{TOURS[id].description}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A one-time offer of the right tour: the Workshop tour on a first visit, a builder's tutorial on its first open. */
export function FirstVisitOffer() {
  const { start, active } = useTour();
  const { pathname } = useLocation();
  const [offer, setOffer] = useState<TourId | null>(null);
  useEffect(() => {
    if (active) { setOffer(null); return; }
    const seen = toursSeen();
    const want: TourId | null = pathname === '/drawers' ? 'drawers' : pathname === '/shelves' ? 'shelves' : 'app';
    setOffer(want && !seen.includes(want) ? want : null);
  }, [pathname, active]);
  if (!offer) return null;
  const dismiss = () => { markTourSeen(offer); setOffer(null); };
  return (
    <div className="tour-offer" role="region" aria-label="Tour">
      <Compass size={20} aria-hidden="true" />
      <span>
        <strong>{offer === 'app' ? 'New to Workshop?' : `New to the ${offer === 'drawers' ? 'Drawer' : 'Shelf'} Builder?`}</strong>
        <small>{TOURS[offer].description}</small>
      </span>
      <button type="button" className="tour-button is-primary" onClick={() => { setOffer(null); start(offer); }}>
        {offer === 'app' ? 'Take the tour' : 'Start the tutorial'}
      </button>
      <button type="button" className="tour-close" onClick={dismiss} aria-label="No thanks"><X size={16} aria-hidden="true" /></button>
    </div>
  );
}

/** A "Tutorial" button for a builder's page header. */
export function TutorialButton({ tour }: { tour: TourId }) {
  const { start } = useTour();
  return (
    <button type="button" className="btn btn-ghost" onClick={() => start(tour)}>
      <Compass size={16} aria-hidden="true" /> Tutorial
    </button>
  );
}

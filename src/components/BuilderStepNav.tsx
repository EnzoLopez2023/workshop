// A sticky row of jump links at the top of a builder's settings: one per step of the
// design (size, look, base…), marking the one in view. It works whether the settings
// scroll on their own (the desktop workbench) or with the page (phones).

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface BuilderStep {
  id: string;
  label: string;
  /** A short state for the chip, e.g. "2 errors". */
  badge?: string;
}

interface Props {
  steps: BuilderStep[];
  /** The settings column (it may or may not be the thing that scrolls). */
  containerRef: RefObject<HTMLElement | null>;
}

export default function BuilderStepNav({ steps, containerRef }: Props) {
  const navRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(steps[0]?.id ?? '');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let current = steps[0]?.id ?? '';
      for (const step of steps) {
        const el = document.getElementById(step.id);
        if (el && el.getBoundingClientRect().top <= line) current = step.id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
    };
  }, [containerRef, steps]);

  // Scroll whichever is scrolling — the settings column on a desktop, the page on a phone —
  // so the step's heading lands just under this bar (scrollIntoView would move both).
  const go = (id: string) => {
    const el = document.getElementById(id);
    const container = containerRef.current;
    if (!el || !container) return;
    const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    // Where the bar's bottom will be once it's stuck (it may still be scrolling up into place).
    const nav = navRef.current;
    const stuckBottom = nav ? (parseFloat(getComputedStyle(nav).top) || 0) + nav.getBoundingClientRect().height : 0;
    if (container.scrollHeight > container.clientHeight + 1 && getComputedStyle(container).overflowY !== 'visible') {
      const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top - stuckBottom - 8;
      container.scrollTo({ top: container.scrollTop + offset, behavior });
    } else {
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - stuckBottom - 8, behavior });
    }
    setActive(id);
  };

  return (
    <nav ref={navRef} className="builder-step-nav" aria-label="Design steps">
      <ol>
        {steps.map((step, i) => (
          <li key={step.id}>
            <button type="button" aria-current={active === step.id ? 'step' : undefined} onClick={() => go(step.id)}>
              <span className="builder-step-num" aria-hidden="true">{i + 1}</span>
              {step.label}
              {step.badge && <span className="builder-step-badge">{step.badge}</span>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

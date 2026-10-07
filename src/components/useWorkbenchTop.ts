import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Desktop builder workbench: records where the settings-and-preview layout starts on
 * the page (as --workbench-top on it), so CSS can size it to fill the rest of the window.
 * Workbench CSS lives with the builder styles in index.css (.builder-workbench).
 */
export function useWorkbenchTop(ref: RefObject<HTMLElement | null>) {
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    // Pushed far down (an open library panel above it), it takes a whole screen once scrolled to.
    const value = `${Math.round(top > window.innerHeight * 0.4 ? 16 : top)}px`;
    if (el.style.getPropertyValue('--workbench-top') !== value) el.style.setProperty('--workbench-top', value);
  };

  // Whatever re-renders the page (an opened panel, a banner) may move it.
  useLayoutEffect(measure);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
}

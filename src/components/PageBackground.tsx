// Full-page photo backdrop for the current route. A single fixed image spans the
// viewport behind the header + page content, with a gentle scroll-linked parallax
// drift and a theme-aware legibility veil (--color-page-veil) so cards and text
// stay readable. The image is chosen from the current pathname, so every page
// gets its own backdrop. Images live in public/bg-<page>.jpg (produced by
// scripts/generate-backgrounds.mjs).

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

function imageForPath(path: string): string {
  if (path.startsWith('/projects')) return '/bg-projects.jpg';
  if (path.startsWith('/shaper')) return '/bg-shaper.jpg';
  if (path.startsWith('/conversions')) return '/bg-conversions.jpg';
  if (path.startsWith('/shopping-list')) return '/bg-shopping.jpg';
  if (path.startsWith('/notebook')) return '/bg-notebook.jpg';
  if (path.startsWith('/settings')) return '/bg-settings.jpg';
  return '/bg-dashboard.jpg';
}

export default function PageBackground() {
  const { pathname } = useLocation();
  const reduce = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  // Drift the (over-tall) image down slightly as the page scrolls — parallax.
  const y = useTransform(scrollY, [0, 900], [0, reduce ? 0 : 80]);
  const image = useMemo(() => imageForPath(pathname), [pathname]);

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <motion.div
        key={image}
        style={{
          position: 'absolute',
          // Taller than the viewport so the parallax drift never reveals an edge.
          inset: '-12% 0 -12% 0',
          backgroundImage: `url(${image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          y,
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: 'var(--color-page-veil)' }} />
    </div>
  );
}

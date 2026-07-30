// The hall behind the board. Not a picture of a workshop — the rest of the board
// itself: rank on rank of blank flap cells, each with its seam, running off past
// the content. It is the same field on every route (the frame is carried, the
// content changes), but each route parks the board at a different column, so
// moving between pages reads as the board sliding to another section.

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

const CELL_W = 116;

function columnForPath(path: string): number {
  if (path.startsWith('/projects')) return 1;
  if (path.startsWith('/shaper')) return 2;
  if (path.startsWith('/conversions')) return 3;
  if (path.startsWith('/shopping-list')) return 4;
  if (path.startsWith('/notebook')) return 5;
  if (path.startsWith('/settings')) return 6;
  return 0;
}

export default function PageBackground() {
  const { pathname } = useLocation();
  const reduce = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 1200], [0, reduce ? 0 : 44]);
  const x = useMemo(() => -columnForPath(pathname) * (CELL_W / 3), [pathname]);

  return (
    <div className="page-field" aria-hidden>
      <motion.div style={{ position: 'absolute', inset: 0, y }}>
        <motion.div
          className="page-field-cells"
          animate={{ x: reduce ? 0 : x }}
          transition={reduce ? { duration: 0 } : { duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </motion.div>
    </div>
  );
}

// A Solari split-flap readout. Characters live in individual flap cells and, when
// the value changes, roll through the drum toward their target the way a real
// board does — bounded to a handful of steps so it never outstays its welcome.
// Under prefers-reduced-motion the value simply swaps.

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

// The drum, in the order a Solari board actually carries its flaps.
const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:$-/+';
const MAX_STEPS = 5;
const STEP_MS = 55;
const COLUMN_STAGGER_MS = 45;

const BLANK = '\u00A0';

const show = (ch: string) => (ch === ' ' ? BLANK : ch);

function drumIndex(ch: string): number {
  const i = DRUM.indexOf(ch.toUpperCase());
  return i === -1 ? 0 : i;
}

/** The characters a cell rolls through to get from `from` to `to`, capped. */
function rollPath(from: string, to: string): string[] {
  const end = drumIndex(to);
  const distance = (end - drumIndex(from) + DRUM.length) % DRUM.length;
  const steps = Math.min(distance, MAX_STEPS);
  const path: string[] = [];
  for (let s = steps - 1; s >= 0; s--) {
    path.push(DRUM[(end - s + DRUM.length) % DRUM.length]);
  }
  return path;
}

interface Props {
  value: string;
  /** Pad on the left with blank flaps so the readout keeps a fixed width. */
  cells?: number;
  /** Accessible text; defaults to the value itself. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'ink' | 'amber' | 'green' | 'red';
  className?: string;
}

export default function SplitFlap({
  value,
  cells,
  label,
  size = 'md',
  tone = 'ink',
  className = '',
}: Props) {
  const reduce = useReducedMotion() ?? false;
  const target = (cells ? value.padStart(cells, ' ') : value).toUpperCase();

  const initial = useRef(target.split('').map(show));
  const [display, setDisplay] = useState<string[]>(initial.current);
  const [ticks, setTicks] = useState<number[]>(() => initial.current.map(() => 0));
  const displayRef = useRef<string[]>(initial.current);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const want = target.split('');
    const prev = displayRef.current;
    const next = want.map((_, i) => prev[i] ?? BLANK);

    if (reduce) {
      displayRef.current = want.map(show);
      setDisplay(displayRef.current);
      setTicks(want.map(() => 0));
      return;
    }

    displayRef.current = next;
    setDisplay(next);
    setTicks(t => want.map((_, i) => t[i] ?? 0));

    want.forEach((ch, i) => {
      const from = next[i] === BLANK ? ' ' : next[i];
      if (from === ch) return;

      rollPath(from, ch).forEach((step, s) => {
        timers.current.push(
          setTimeout(() => {
            const copy = [...displayRef.current];
            copy[i] = show(step);
            displayRef.current = copy;
            setDisplay(copy);
            setTicks(t => {
              const n = [...t];
              n[i] = (n[i] ?? 0) + 1;
              return n;
            });
          }, i * COLUMN_STAGGER_MS + s * STEP_MS),
        );
      });
    });

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [target, reduce]);

  return (
    <span className={`flapboard flapboard-${size} flapboard-${tone} ${className}`}>
      <span className="sr-only">{label ?? value}</span>
      <span className="flapboard-cells" aria-hidden="true">
        {display.map((ch, i) => (
          <span className="flapcell" key={i}>
            {/* A fresh key on each change remounts the face, restarting the fall. */}
            <span className="flapcell-face" key={ticks[i] ?? 0}>
              {ch}
            </span>
            <span className="flapcell-seam" />
          </span>
        ))}
      </span>
    </span>
  );
}

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

/**
 * useState with undo and redo. Changes made within `mergeMs` of each other (typing in a field,
 * stepping a number) count as one step.
 */
export function useHistoryState<T>(initial: T | (() => T), mergeMs = 700) {
  const [state, setRaw] = useState<T>(initial);
  const current = useRef(state);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastChange = useRef(0);
  const [, bump] = useState(0);

  const set = useCallback((next: SetStateAction<T>) => {
    const prev = current.current;
    const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
    if (Object.is(value, prev)) return;
    const now = Date.now();
    if (past.current.length === 0 || now - lastChange.current > mergeMs) {
      past.current.push(prev);
      if (past.current.length > 100) past.current.shift();
    }
    lastChange.current = now;
    future.current = [];
    current.current = value;
    setRaw(value);
    bump(n => n + 1);
  }, [mergeMs]);

  const undo = useCallback(() => {
    const value = past.current.pop();
    if (value === undefined) return;
    future.current.push(current.current);
    current.current = value;
    lastChange.current = 0;
    setRaw(value);
    bump(n => n + 1);
  }, []);

  const redo = useCallback(() => {
    const value = future.current.pop();
    if (value === undefined) return;
    past.current.push(current.current);
    current.current = value;
    lastChange.current = 0;
    setRaw(value);
    bump(n => n + 1);
  }, []);

  return [state, set, { undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }] as const;
}

/** Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (or Ctrl+Y), except while typing in a field, which has its own undo. */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}

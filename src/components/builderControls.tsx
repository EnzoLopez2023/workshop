// Form controls and drawing helpers shared by the Shelf Builder and Drawer Builder.

import { useState } from 'react';
import { Lock, Minus, Plus } from 'lucide-react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from '@floating-ui/react';
import { IconButton } from './ui';
import type { LengthUnit } from '../lib/shelving';

// ── Controls ──────────────────────────────────────────────────────────────────

export function LengthField({
  unit, label, value, onChange, hint, error, disabled, placeholder,
}: {
  unit: LengthUnit;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="form-field">
      <span className="form-field-label">{label}</span>
      <span className="shelf-inch-input">
        <input
          value={value}
          inputMode="decimal"
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={e => onChange(e.target.value)}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
      {error ? <small className="shelf-field-error">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}

export function Stepper({
  value, min, max, onChange, labelledBy, noun,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labelledBy: string;
  noun: string;
}) {
  return (
    <div className="shelf-stepper" role="group" aria-labelledby={labelledBy}>
      <IconButton label={`Remove a ${noun}`} onClick={() => onChange(value - 1)} disabled={value <= min}>
        <Minus size={16} aria-hidden="true" />
      </IconButton>
      <output aria-live="polite">{value}</output>
      <IconButton label={`Add a ${noun}`} onClick={() => onChange(value + 1)} disabled={value >= max}>
        <Plus size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/**
 * A checkbox with a label and a hint. When it's blocked by another setting, pass the reason:
 * it's greyed out with a lock, and the reason shows as a tooltip on hover or keyboard focus.
 */
export function Toggle({
  label, checked, onChange, hint, disabled, disabledReason,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
  /** Why it can't be turned on right now; makes it disabled and explains on hover or focus. */
  disabledReason?: string;
}) {
  const reason = disabledReason || undefined;
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: open && !!reason,
    onOpenChange: setOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const hover = useHover(context, { enabled: !!reason, delay: { open: 120, close: 0 } });
  const focus = useFocus(context, { enabled: !!reason });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  return (
    <>
      <label
        ref={refs.setReference}
        className={`shelf-toggle${reason ? ' is-blocked' : ''}`}
        // A disabled checkbox can't take focus, so the label does, to reach the reason by keyboard.
        tabIndex={reason ? 0 : undefined}
        {...(reason ? getReferenceProps() : {})}
      >
        <input type="checkbox" checked={checked} disabled={disabled || !!reason} onChange={e => onChange(e.target.checked)} />
        <span>
          <span className="shelf-toggle-label">
            {label}
            {reason && <Lock size={12} aria-hidden="true" className="shelf-toggle-lock" />}
          </span>
          {hint && <small>{hint}</small>}
        </span>
      </label>
      {open && reason && (
        <FloatingPortal>
          <div ref={refs.setFloating} className="tooltip tooltip-wrap" style={floatingStyles} {...getFloatingProps()}>
            {reason}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'is-accent' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ── Drawing dimensions ──────────────────────────────────────────────────────

export function DimH({ x1, x2, y, label, fs }: { x1: number; x2: number; y: number; label: string; fs: number }) {
  const tick = fs * 0.5;
  return (
    <g className="shelf-dim">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - tick} x2={x1} y2={y + tick} />
      <line x1={x2} y1={y - tick} x2={x2} y2={y + tick} />
      <text className="shelf-dim-text" x={(x1 + x2) / 2} y={y - tick * 0.6} fontSize={fs} textAnchor="middle">{label}</text>
    </g>
  );
}

export function DimV({ y1, y2, x, label, fs }: { y1: number; y2: number; x: number; label: string; fs: number }) {
  const tick = fs * 0.5;
  const cy = (y1 + y2) / 2;
  return (
    <g className="shelf-dim">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - tick} y1={y1} x2={x + tick} y2={y1} />
      <line x1={x - tick} y1={y2} x2={x + tick} y2={y2} />
      <text className="shelf-dim-text" x={x + tick * 0.8} y={cy} fontSize={fs} transform={`rotate(90 ${x + tick * 0.8} ${cy})`} textAnchor="middle">{label}</text>
    </g>
  );
}

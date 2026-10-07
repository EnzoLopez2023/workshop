// Form controls and drawing helpers shared by the Shelf Builder and Drawer Builder.

import { Minus, Plus } from 'lucide-react';
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

export function Toggle({
  label, checked, onChange, hint, disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="shelf-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="shelf-toggle-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
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

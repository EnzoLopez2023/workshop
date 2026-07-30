import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Ruler } from 'lucide-react';

// ── Math helpers ──────────────────────────────────────────────

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function toFrac32(inches: number): string {
  if (inches <= 0) return '0"';
  const whole = Math.floor(inches);
  const frac = inches - whole;
  let n = Math.round(frac * 32);
  if (n >= 32) return `${whole + 1}"`;
  if (n === 0) return `${whole}"`;
  const g = gcd(n, 32);
  const num = n / g;
  const den = 32 / g;
  return whole > 0 ? `${whole} ${num}/${den}"` : `${num}/${den}"`;
}

function toFrac8Label(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rem = eighths % 8;
  if (rem === 0) return `${whole}"`;
  const g = gcd(rem, 8);
  const num = rem / g;
  const den = 8 / g;
  return whole > 0 ? `${whole} ${num}/${den}"` : `${num}/${den}"`;
}

// ── Precomputed tables ────────────────────────────────────────

const MM_TABLE = Array.from({ length: 100 }, (_, i) => {
  const mm = i + 1;
  const dec = mm / 25.4;
  return { mm, dec, frac: toFrac32(dec) };
});

const IN_TABLE = Array.from({ length: 96 }, (_, i) => {
  const inches = i + 1;
  return { inches, mm: inches * 25.4 };
});

// 48 groups × 8 eighths = 384 fractional entries (1/8" → 48")
const FRAC_GROUPS: { label: string; mm: number }[][] = Array.from({ length: 48 }, (_, whole) =>
  Array.from({ length: 8 }, (_, eighth) => {
    const eighths = whole * 8 + eighth + 1;
    return { label: toFrac8Label(eighths), mm: +(eighths / 8 * 25.4).toFixed(3) };
  })
);

// ── Component ─────────────────────────────────────────────────

type ActiveTab = 'mm-to-in' | 'in-to-mm' | 'frac-to-mm';

export default function ConversionTables() {
  const navigate = useNavigate();
  const [inputVal, setInputVal] = useState('');
  const [unit, setUnit]         = useState<'mm' | 'in'>('mm');
  const [tab, setTab]           = useState<ActiveTab>('mm-to-in');

  const num   = parseFloat(inputVal) || 0;
  const mmVal = unit === 'mm' ? num : num * 25.4;
  const inVal = unit === 'in' ? num : num / 25.4;
  const hasVal = num > 0;

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'mm-to-in',   label: 'MM → Inches' },
    { key: 'in-to-mm',   label: 'Inches → MM' },
    { key: 'frac-to-mm', label: 'Fractional → MM' },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 40px 80px' }}>

      {/* Back */}
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ gap: 6, marginBottom: 32 }}>
        <ArrowLeft size={14} /> Back
      </button>

      {/* Title */}
      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">
            <Ruler size={20} strokeWidth={2.2} style={{ color: 'var(--color-amber)', display: 'inline-block', verticalAlign: '-2px', marginRight: 10 }} />
            Unit Conversions
          </h1>
          <p className="page-sub">Millimetre and inch reference tables, plus a calculator for whatever the plan didn't list.</p>
        </div>
      </div>

      {/* ── Calculator ── */}
      <div className="card" style={{ padding: '24px 28px', marginBottom: 36 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 16 }}>
          Quick Converter
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            type="number"
            min="0"
            step="any"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            placeholder="Enter a value…"
            style={{ width: 180, fontSize: '1.1rem', fontWeight: 600 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['mm', 'in'] as const).map(u => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className="btn"
                style={{
                  backgroundColor: unit === u ? 'var(--color-steel)' : 'var(--color-flap-shade)',
                  color: unit === u ? 'var(--color-concourse)' : 'var(--color-ink)',
                  padding: '7px 14px', fontSize: '0.82rem',
                }}
              >
                {u === 'mm' ? 'millimeters' : 'inches'}
              </button>
            ))}
          </div>
        </div>

        {hasVal && (
          <div style={{ marginTop: 20, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <ResultPill label="Millimeters" value={`${mmVal.toFixed(3)} mm`} />
            <ResultPill label="Decimal Inches" value={`${inVal.toFixed(5)}"`} />
            <ResultPill label={'Nearest 1/32"'} value={toFrac32(inVal)} accent />
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="btn"
              style={{
                backgroundColor: active ? 'var(--color-steel)' : 'var(--color-flap-shade)',
                color: active ? 'var(--color-concourse)' : 'var(--color-ink)',
                padding: '8px 16px', fontSize: '0.82rem',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Table: MM → Inches ── */}
      {tab === 'mm-to-in' && (
        <div>
          <SectionNote>1 – 100 mm converted to decimal and fractional inches (nearest 1/32&quot;)</SectionNote>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  <Th>MM</Th>
                  <Th>Decimal Inches</Th>
                  <Th>Nearest 1/32&quot;</Th>
                </tr>
              </thead>
              <tbody>
                {MM_TABLE.map(row => (
                  <tr
                    key={row.mm}
                    style={{ borderBottom: '1px solid var(--color-line)', backgroundColor: row.mm % 2 === 0 ? 'var(--color-flap-shade)' : undefined }}
                  >
                    <Td>{row.mm} mm</Td>
                    <Td muted>{row.dec.toFixed(5)}&quot;</Td>
                    <Td bold>{row.frac}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Table: Inches → MM ── */}
      {tab === 'in-to-mm' && (
        <div>
          <SectionNote>1&quot; – 96&quot; whole inches converted to millimeters (1&quot; = 25.4 mm exactly)</SectionNote>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[0, 1].map(half => (
              <div key={half} className="card" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr>
                      <Th>Inches</Th>
                      <Th>Millimeters</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {IN_TABLE.slice(half * 48, half * 48 + 48).map(row => (
                      <tr
                        key={row.inches}
                        style={{ borderBottom: '1px solid var(--color-line)', backgroundColor: row.inches % 2 === 0 ? 'var(--color-flap-shade)' : undefined }}
                      >
                        <Td>{row.inches}&quot;</Td>
                        <Td bold>{row.mm.toFixed(1)} mm</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Table: Fractional → MM ── */}
      {tab === 'frac-to-mm' && (
        <div>
          <SectionNote>1/8&quot; increments from 1/8&quot; to 48&quot; — each row shows one full inch grouped by eighths</SectionNote>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                    <th key={n} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', color: 'var(--color-muted)', borderRight: n < 8 ? '1px solid var(--color-line)' : undefined }}>
                      {n === 1 ? '1/8th' : n === 2 ? '2/8th (1/4)' : n === 3 ? '3/8th' : n === 4 ? '4/8th (1/2)' : n === 5 ? '5/8th' : n === 6 ? '6/8th (3/4)' : n === 7 ? '7/8th' : '8/8th (1)'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FRAC_GROUPS.map((group, wholeIdx) => (
                  <tr
                    key={wholeIdx}
                    style={{ borderBottom: '1px solid var(--color-line)', backgroundColor: wholeIdx % 2 === 0 ? 'var(--color-flap-shade)' : undefined }}
                  >
                    {group.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        style={{
                          padding: '7px 10px',
                          borderRight: cellIdx < 7 ? '1px solid var(--color-line)' : undefined,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{cell.label}</span>
                        <span style={{ color: 'var(--color-muted)', marginLeft: 6, fontSize: '0.78rem' }}>{cell.mm} mm</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────

function ResultPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: '1.35rem', fontWeight: 700,
        color: accent ? 'var(--color-amber)' : 'var(--color-ink)',
        fontFamily: accent ? 'var(--font-board)' : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
      {children}
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '9px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', color: 'var(--color-muted)', borderRight: '1px solid var(--color-line)' }}>
      {children}
    </th>
  );
}

function Td({ children, muted, bold }: { children: React.ReactNode; muted?: boolean; bold?: boolean }) {
  return (
    <td style={{
      padding: '8px 16px',
      color: muted ? 'var(--color-muted)' : 'var(--color-ink)',
      fontWeight: bold ? 600 : undefined,
      borderRight: '1px solid var(--color-line)',
    }}>
      {children}
    </td>
  );
}

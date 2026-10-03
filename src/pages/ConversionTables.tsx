import { useState } from 'react';
import { ArrowLeft, Check, Clipboard, RotateCcw, Ruler } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import {
  convertMeasurement,
  FRAC_GROUPS,
  IN_TABLE,
  MM_TABLE,
  type ConversionTab,
  type ConversionUnit,
} from '../lib/conversions';

const UNIT_OPTIONS = [
  { value: 'mm', label: 'Millimeters' },
  { value: 'in', label: 'Inches' },
] as const;

const TABLE_OPTIONS = [
  { value: 'mm-to-in', label: 'MM → Inches' },
  { value: 'in-to-mm', label: 'Inches → MM' },
  { value: 'frac-to-mm', label: 'Fractional → MM' },
] as const;

export default function ConversionTables() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [unit, setUnit] = useState<ConversionUnit>('mm');
  const [tab, setTab] = useState<ConversionTab>('mm-to-in');
  const [copyStatus, setCopyStatus] = useState('');
  const conversion = convertMeasurement(inputValue, unit);
  const hasValue = conversion.number > 0;

  const reset = () => {
    setInputValue('');
    setCopyStatus('');
  };

  const copyResults = async () => {
    if (!hasValue) return;
    if (!navigator.clipboard?.writeText) {
      setCopyStatus('Copy is not available in this browser.');
      return;
    }
    const text = [
      `${conversion.millimeters.toFixed(3)} mm`,
      `${conversion.inches.toFixed(5)}"`,
      `${conversion.fraction} (nearest 1/32")`,
    ].join(' · ');
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Conversion copied.');
    } catch (error) {
      console.error('Conversion copy failed', error);
      setCopyStatus('The conversion could not be copied. Select the values instead.');
    }
  };

  return (
    <PageFrame maxWidth={1100} className="conversion-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Unit Conversions"
        description="Exact millimeter and inch references for the dimensions that arrive in either system."
      />

      <section className="conversion-workbench" aria-labelledby="quick-converter-title">
        <div className="conversion-workbench-heading">
          <span aria-hidden="true"><Ruler size={21} /></span>
          <div>
            <h2 id="quick-converter-title">Quick converter</h2>
            <p>Enter one positive measurement. Results keep the precision shown in the reference tables.</p>
          </div>
        </div>

        <div className="conversion-inputs">
          <label className="form-field">
            <span className="form-field-label">Measurement</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={inputValue}
              onChange={event => {
                setInputValue(event.target.value);
                setCopyStatus('');
              }}
              placeholder="Enter a value"
              aria-describedby="conversion-input-help"
            />
            <small id="conversion-input-help">Values are rounded only for display.</small>
          </label>
          <div className="conversion-unit-control">
            <span className="form-field-label">Input unit</span>
            <SegmentedControl
              label="Input unit"
              value={unit}
              options={UNIT_OPTIONS}
              onChange={setUnit}
            />
          </div>
        </div>

        <dl className="conversion-results" aria-live="polite">
          {hasValue ? (
            <>
              <ConversionResult label="Millimeters" value={`${conversion.millimeters.toFixed(3)} mm`} />
              <ConversionResult label="Decimal inches" value={`${conversion.inches.toFixed(5)}"`} />
              <ConversionResult label={'Nearest 1/32"'} value={conversion.fraction} accent />
            </>
          ) : (
            <p className="conversion-placeholder">Results will appear here.</p>
          )}
        </dl>

        <div className="conversion-actions">
          <Button onClick={() => void copyResults()} disabled={!hasValue}>
            {copyStatus === 'Conversion copied.'
              ? <Check size={16} aria-hidden="true" />
              : <Clipboard size={16} aria-hidden="true" />}
            Copy results
          </Button>
          <Button variant="ghost" onClick={reset} disabled={!inputValue}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset
          </Button>
          <span className="conversion-copy-status" role="status">{copyStatus}</span>
        </div>
      </section>

      <section className="conversion-reference" aria-labelledby="conversion-reference-title">
        <div className="conversion-reference-heading">
          <div>
            <h2 id="conversion-reference-title">Reference tables</h2>
            <p>Use the full tables when a plan gives a dimension without its counterpart.</p>
          </div>
          <SegmentedControl
            label="Reference table"
            value={tab}
            options={TABLE_OPTIONS}
            onChange={setTab}
          />
        </div>

        {tab === 'mm-to-in' && <MillimeterTable />}
        {tab === 'in-to-mm' && <InchTable />}
        {tab === 'frac-to-mm' && <FractionTable />}
      </section>
    </PageFrame>
  );
}

function ConversionResult({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? 'conversion-result is-accent' : 'conversion-result'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MillimeterTable() {
  return (
    <div className="conversion-table-block">
      <p>1–100 mm converted to decimal and fractional inches, nearest 1/32&quot;.</p>
      <div className="conversion-table-scroll" tabIndex={0} aria-label="Millimeters to inches table">
        <table>
          <caption className="sr-only">Millimeters to decimal and fractional inches</caption>
          <thead>
            <tr>
              <th scope="col">Millimeters</th>
              <th scope="col">Decimal inches</th>
              <th scope="col">Nearest 1/32&quot;</th>
            </tr>
          </thead>
          <tbody>
            {MM_TABLE.map(row => (
              <tr key={row.millimeters}>
                <td>{row.millimeters} mm</td>
                <td className="is-muted">{row.inches.toFixed(5)}&quot;</td>
                <td className="is-strong">{row.fraction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InchTable() {
  return (
    <div className="conversion-table-block">
      <p>1–96 whole inches converted at exactly 25.4 millimeters per inch.</p>
      <div className="conversion-inch-tables">
        {[0, 1].map(half => (
          <div
            className="conversion-table-scroll"
            tabIndex={0}
            aria-label={`${half === 0 ? '1 to 48' : '49 to 96'} inches to millimeters table`}
            key={half}
          >
            <table>
              <caption className="sr-only">
                {half === 0 ? '1 to 48' : '49 to 96'} inches to millimeters
              </caption>
              <thead>
                <tr>
                  <th scope="col">Inches</th>
                  <th scope="col">Millimeters</th>
                </tr>
              </thead>
              <tbody>
                {IN_TABLE.slice(half * 48, half * 48 + 48).map(row => (
                  <tr key={row.inches}>
                    <td>{row.inches}&quot;</td>
                    <td className="is-strong">{row.millimeters.toFixed(1)} mm</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function FractionTable() {
  return (
    <div className="conversion-table-block">
      <p>1/8&quot; increments from 1/8&quot; through 48&quot;, grouped by each full inch.</p>
      <div className="conversion-table-scroll" tabIndex={0} aria-label="Fractional inches to millimeters table">
        <table className="fraction-table">
          <caption className="sr-only">Fractional inches in eighths to millimeters</caption>
          <thead>
            <tr>
              {['1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8', '1 inch'].map(label => (
                <th scope="col" key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FRAC_GROUPS.map((group, groupIndex) => (
              <tr key={groupIndex}>
                {group.map(cell => (
                  <td key={cell.label}>
                    <strong>{cell.label}</strong>
                    <span>{cell.millimeters} mm</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

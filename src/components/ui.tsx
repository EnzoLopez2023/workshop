import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'next' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const variantClass = variant === 'secondary' ? 'btn-muted' : `btn-${variant}`;
  return <button type={type} className={`btn ${variantClass} ${className}`.trim()} {...props} />;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, className = '', type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    />
  );
}

interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  maxWidth?: CSSProperties['maxWidth'];
}

export function PageFrame({ maxWidth, className = '', style, ...props }: PageFrameProps) {
  return (
    <div
      className={`page-container ${className}`.trim()}
      style={{ ...style, maxWidth }}
      {...props}
    />
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

interface SectionRailProps {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
}

export function SectionRail({ title, count, actions }: SectionRailProps) {
  return (
    <div className="rail">
      <span>{title}</span>
      {count !== undefined && <span className="rail-count">{count}</span>}
      {actions && <span className="rail-actions">{actions}</span>}
    </div>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface StatePanelProps {
  title: string;
  description?: string;
  tone?: 'neutral' | 'danger';
  action?: ReactNode;
}

export function StatePanel({
  title,
  description,
  tone = 'neutral',
  action,
}: StatePanelProps) {
  return (
    <section className={`state-panel state-panel-${tone}`} aria-live="polite">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </section>
  );
}

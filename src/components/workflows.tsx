import type { MouseEvent, ReactNode } from 'react';
import { Box, Cpu, Hammer, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DASHBOARD_PAGE_STORAGE_KEY,
  type DashboardPage,
} from '../navigation';

function rememberDashboardPage(page: DashboardPage) {
  localStorage.setItem(DASHBOARD_PAGE_STORAGE_KEY, page);
}

function selectProjectType(
  event: MouseEvent<HTMLAnchorElement>,
  page: DashboardPage,
) {
  rememberDashboardPage(page);
  event.currentTarget.closest('details')?.removeAttribute('open');
}

export function CreateProjectMenu({
  align = 'start',
  compact = false,
}: {
  align?: 'start' | 'end';
  compact?: boolean;
}) {
  return (
    <details className={`create-menu create-menu-${align}`}>
      <summary
        className={compact ? 'icon-button' : 'btn btn-primary'}
        aria-label={compact ? 'Create project' : undefined}
        title={compact ? 'Create project' : undefined}
      >
        <Plus size={compact ? 21 : 17} aria-hidden="true" />
        {!compact && <span>New project</span>}
      </summary>
      <div className="create-menu-popover">
        <Link
          to="/projects/new"
          onClick={event => selectProjectType(event, 'projects')}
        >
          <Hammer size={18} aria-hidden="true" />
          <span><strong>Project</strong><small>Plan, materials, cuts, and build log</small></span>
        </Link>
        <Link
          to="/shaper/new"
          onClick={event => selectProjectType(event, 'shaper')}
        >
          <Cpu size={18} aria-hidden="true" />
          <span><strong>Shaper Hub project</strong><small>Import CNC parts and instructions</small></span>
        </Link>
        <Link
          to="/bambu/new"
          onClick={event => selectProjectType(event, 'bambu')}
        >
          <Box size={18} aria-hidden="true" />
          <span><strong>Bambu Hub project</strong><small>Import 3D files and source images</small></span>
        </Link>
      </div>
    </details>
  );
}

export function WorkflowSection({
  id,
  title,
  description,
  actions,
  children,
  className = '',
}: {
  id?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`workflow-section ${className}`.trim()} aria-labelledby={headingId}>
      <header className="workflow-section-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="workflow-section-actions">{actions}</div>}
      </header>
      <div className="workflow-section-body">{children}</div>
    </section>
  );
}

export function FormSection({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`form-section ${className}`.trim()}>
      <legend>{title}</legend>
      {description && <p className="form-section-description">{description}</p>}
      <div className="form-section-fields">{children}</div>
    </fieldset>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-field-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

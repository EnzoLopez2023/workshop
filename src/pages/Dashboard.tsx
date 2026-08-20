import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Boxes,
  Clock3,
  Copy,
  Cpu,
  Hammer,
  LayoutTemplate,
  Layers3,
  Search,
  Trash2,
} from 'lucide-react';
import {
  cloneTemplate,
  deleteTemplate,
  imageUrl,
  listProjects,
  listShaperProjects,
  listTemplates,
} from '../services/api';
import type {
  ProjectListItem,
  ShaperProject,
  TemplateListItem,
} from '../types/project';
import {
  DASHBOARD_PAGE_STORAGE_KEY,
  readDashboardPage,
  type DashboardPage,
} from '../navigation';
import ProjectCard from '../components/ProjectCard';
import ShaperProjectCard from '../components/ShaperProjectCard';
import StatusBadge from '../components/StatusBadge';
import { ProjectCardSkeleton } from '../components/Skeleton';
import {
  Button,
  PageFrame,
  PageHeader,
  SectionRail,
  SegmentedControl,
  StatePanel,
} from '../components/ui';
import { CreateProjectMenu } from '../components/workflows';
import {
  filterProjects,
  filterShaperProjects,
  PROJECT_NEXT_ACTION,
  PROJECT_STATUS_ORDER,
  selectFocusProject,
  sortProjects,
  type ProjectStatusFilter,
} from '../lib/coreWorkflows';
import { useSettings } from '../contexts/SettingsContext';

const DASHBOARD_PAGES = [
  { value: 'projects', label: 'Projects' },
  { value: 'shaper', label: 'Shaper Hub' },
] as const;

const FILTERS: { key: ProjectStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'idea', label: 'Ideas' },
  { key: 'planning', label: 'Planning' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
];

const DIY_SITES = [
  { name: 'Kreg Tool Plans', tagline: 'Pocket-hole projects and free plans', url: 'https://learn.kregtool.com/projects-plans/' },
  { name: 'Shanty 2 Chic', tagline: 'Farmhouse builds on a budget', url: 'https://www.shanty-2-chic.com/' },
  { name: 'Ana White', tagline: 'Free plans for every skill level', url: 'https://www.ana-white.com/' },
  { name: 'Houseful of Handmade', tagline: 'Modern DIY furniture and home decor', url: 'https://housefulofhandmade.com/' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [page, setPageState] = useState<DashboardPage>(() =>
    readDashboardPage(localStorage.getItem(DASHBOARD_PAGE_STORAGE_KEY)),
  );
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [shaperProjects, setShaperProjects] = useState<ShaperProject[]>([]);
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectStatusFilter>('all');
  const [projectSearch, setProjectSearch] = useState('');
  const [shaperSearch, setShaperSearch] = useState('');
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextProjects, nextShaperProjects, nextTemplates] = await Promise.all([
        listProjects(),
        listShaperProjects(),
        listTemplates(),
      ]);
      setProjects(nextProjects);
      setShaperProjects(nextShaperProjects);
      setTemplates(nextTemplates);
    } catch (error) {
      console.error('Dashboard load failed', error);
      setLoadError('Workshop could not load your projects. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const setPage = (next: DashboardPage) => {
    setPageState(next);
    localStorage.setItem(DASHBOARD_PAGE_STORAGE_KEY, next);
  };

  const openProject = (id: number) => {
    setPage('projects');
    navigate(`/projects/${id}`);
  };

  const handleUseTemplate = async (id: number) => {
    setCloningId(id);
    setLoadError(null);
    try {
      const project = await cloneTemplate(id);
      openProject(project.id);
    } catch (error) {
      console.error('Template clone failed', error);
      setLoadError('Workshop could not create a project from that template. Try again.');
    } finally {
      setCloningId(null);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    setLoadError(null);
    try {
      await deleteTemplate(id);
      setTemplates(current => current.filter(template => template.id !== id));
    } catch (error) {
      console.error('Template delete failed', error);
      setLoadError('Workshop could not delete that template. Try again.');
    }
  };

  const filteredProjects = useMemo(
    () => sortProjects(
      filterProjects(projects, filter, projectSearch, settings.showCompletedByDefault),
      settings.defaultDashboardSort,
    ),
    [
      projects,
      filter,
      projectSearch,
      settings.defaultDashboardSort,
      settings.showCompletedByDefault,
    ],
  );
  const filteredShaperProjects = useMemo(
    () => filterShaperProjects(shaperProjects, shaperSearch),
    [shaperProjects, shaperSearch],
  );
  const focusProject = useMemo(
    () => selectFocusProject(
      settings.showCompletedByDefault
        ? projects
        : projects.filter(project => project.status !== 'completed'),
    ),
    [projects, settings.showCompletedByDefault],
  );

  return (
    <PageFrame>
      <PageHeader
        title={page === 'projects' ? 'Projects' : 'Shaper Hub'}
        description={page === 'projects'
          ? 'Move one idea from plan to materials, cuts, shopping, and build log.'
          : 'Keep CNC references, stock, parts, and instructions together without mixing project types.'}
        actions={<CreateProjectMenu align="end" />}
      />

      <div className="dashboard-switcher">
        <SegmentedControl
          label="Project type"
          value={page}
          options={DASHBOARD_PAGES}
          onChange={setPage}
        />
      </div>

      {loadError && (
        <StatePanel
          title="Projects unavailable"
          description={loadError}
          tone="danger"
          action={<Button onClick={() => void loadDashboard()}>Try again</Button>}
        />
      )}

      {page === 'projects' ? (
        <>
          {!loading && focusProject && (
            <ActiveProject project={focusProject} onOpen={() => openProject(focusProject.id)} />
          )}

          <ProjectTools
            search={projectSearch}
            onSearchChange={setProjectSearch}
            filter={filter}
            onFilterChange={setFilter}
          />

          <section aria-labelledby="project-library-title">
            <SectionRail
              title={<span id="project-library-title"><Boxes size={16} aria-hidden="true" /> Project library</span>}
              count={loading ? '—' : filteredProjects.length}
            />
            {loading ? (
              <ProjectGridSkeleton />
            ) : filteredProjects.length === 0 ? (
              <StatePanel
                title={projects.length === 0 ? 'Start the first plan' : 'No matching projects'}
                description={projects.length === 0
                  ? 'Capture an idea, paste a plan URL, or begin with a blank project.'
                  : 'Change the search or status filter to bring projects back into view.'}
                action={projects.length === 0
                  ? <Button variant="primary" onClick={() => navigate('/projects/new')}>New project</Button>
                  : undefined}
              />
            ) : (
              <div className="project-library-grid">
                {filteredProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    to={`/projects/${project.id}`}
                    onOpen={() => setPage('projects')}
                  />
                ))}
              </div>
            )}
          </section>

          {templates.length > 0 && (
            <TemplatesSection
              templates={templates}
              cloningId={cloningId}
              confirmDeleteTemplateId={confirmDeleteTemplateId}
              onUse={handleUseTemplate}
              onRequestDelete={setConfirmDeleteTemplateId}
              onDelete={handleDeleteTemplate}
            />
          )}

          <InspirationSection />
        </>
      ) : (
        <section className="shaper-dashboard" aria-labelledby="shaper-library-title">
          <div className="dashboard-tools">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search Shaper Hub projects</span>
              <input
                value={shaperSearch}
                onChange={event => setShaperSearch(event.target.value)}
                placeholder="Search Shaper Hub projects"
              />
            </label>
          </div>
          <SectionRail
            title={<span id="shaper-library-title"><Cpu size={16} aria-hidden="true" /> Shaper Hub library</span>}
            count={loading ? '—' : filteredShaperProjects.length}
          />
          {loading ? (
            <ProjectGridSkeleton />
          ) : filteredShaperProjects.length === 0 ? (
            <StatePanel
              title={shaperProjects.length === 0 ? 'No Shaper projects yet' : 'No matching Shaper projects'}
              description={shaperProjects.length === 0
                ? 'Import a Shaper Hub share URL to bring its parts, dimensions, and bit list into Workshop.'
                : 'Change the search to bring projects back into view.'}
              action={shaperProjects.length === 0
                ? <Button variant="primary" onClick={() => navigate('/shaper/new')}>New Shaper project</Button>
                : undefined}
            />
          ) : (
            <div className="project-library-grid">
              {filteredShaperProjects.map(project => (
                <ShaperProjectCard
                  key={project.id}
                  project={project}
                  to={`/shaper/${project.id}`}
                  onOpen={() => setPage('shaper')}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </PageFrame>
  );
}

function ActiveProject({ project, onOpen }: { project: ProjectListItem; onOpen: () => void }) {
  const image = project.hero_image_id ? imageUrl(project.hero_image_id) : null;
  const next = PROJECT_NEXT_ACTION[project.status];
  const currentStage = PROJECT_STATUS_ORDER.indexOf(project.status);

  return (
    <section className="active-project-layer" aria-labelledby="active-project-title">
      <div className="active-project-media">
        {image ? (
          <img src={image} alt="" />
        ) : (
          <div className="active-project-plan" aria-hidden="true">
            <Hammer size={56} strokeWidth={1.4} />
          </div>
        )}
        <div className="active-project-identity">
          <StatusBadge status={project.status} />
          <h2 id="active-project-title">{project.title}</h2>
          {project.description && <p>{project.description}</p>}
        </div>
      </div>

      <div className="active-project-action">
        <span className="active-project-action-icon" aria-hidden="true"><Layers3 size={21} /></span>
        <div>
          <h3>{next.title}</h3>
          <p>{next.description}</p>
        </div>

        <dl className="active-project-meta">
          <div>
            <dt>Parts</dt>
            <dd>{project.parts_count ?? 0}</dd>
          </div>
          <div>
            <dt><Clock3 size={14} aria-hidden="true" /> Shop time</dt>
            <dd>{project.estimated_hours ? `${project.estimated_hours} h` : 'Not set'}</dd>
          </div>
        </dl>

        <div
          className="stage-track"
          role="img"
          aria-label={`Project stage: ${project.status.replace('_', ' ')}`}
        >
          {PROJECT_STATUS_ORDER.map((status, index) => (
            <span
              key={status}
              className={index < currentStage ? 'is-complete' : index === currentStage ? 'is-current' : ''}
            >
              <i aria-hidden="true" />
              <b>{status === 'in_progress' ? 'Build' : status === 'completed' ? 'Done' : status}</b>
            </span>
          ))}
        </div>

        <Button variant="next" onClick={onOpen}>Open project</Button>
      </div>
    </section>
  );
}

function ProjectTools({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: ProjectStatusFilter;
  onFilterChange: (filter: ProjectStatusFilter) => void;
}) {
  return (
    <div className="dashboard-tools">
      <label className="search-field">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search projects</span>
        <input
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Search projects, materials, or parts"
        />
      </label>
      <div className="filter-strip" role="group" aria-label="Filter projects by status">
        {FILTERS.map(option => (
          <button
            type="button"
            key={option.key}
            onClick={() => onFilterChange(option.key)}
            aria-pressed={filter === option.key}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectGridSkeleton() {
  return (
    <div
      className="project-library-grid"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading projects"
    >
      {[0, 1, 2, 3].map(index => <ProjectCardSkeleton key={index} />)}
    </div>
  );
}

function TemplatesSection({
  templates,
  cloningId,
  confirmDeleteTemplateId,
  onUse,
  onRequestDelete,
  onDelete,
}: {
  templates: TemplateListItem[];
  cloningId: number | null;
  confirmDeleteTemplateId: number | null;
  onUse: (id: number) => Promise<void>;
  onRequestDelete: (id: number | null) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  return (
    <section className="dashboard-section" aria-labelledby="template-library-title">
      <SectionRail
        title={<span id="template-library-title"><LayoutTemplate size={16} aria-hidden="true" /> Templates</span>}
        count={templates.length}
      />
      <div className="template-library-grid">
        {templates.map(template => (
          <article key={template.id} className="card template-card">
            {template.hero_image_id && (
              <span className="depart-photo">
                <img src={imageUrl(template.hero_image_id)} alt="" />
              </span>
            )}
            <div className="template-card-copy">
              <h3>{template.template_name || template.title}</h3>
              <p>{template.parts_count} parts · {template.difficulty}</p>
            </div>
            <div className="template-card-actions">
              <Button
                onClick={() => void onUse(template.id)}
                disabled={cloningId === template.id}
              >
                <Copy size={16} aria-hidden="true" />
                {cloningId === template.id ? 'Creating…' : 'Use template'}
              </Button>
              {confirmDeleteTemplateId === template.id ? (
                <>
                  <Button variant="ghost" onClick={() => onRequestDelete(null)}>Cancel</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      void onDelete(template.id);
                      onRequestDelete(null);
                    }}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => onRequestDelete(template.id)}
                  aria-label={`Delete ${template.template_name || template.title} template`}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InspirationSection() {
  return (
    <section className="dashboard-section" aria-labelledby="inspiration-title">
      <SectionRail
        title={<span id="inspiration-title"><Hammer size={16} aria-hidden="true" /> Build inspiration</span>}
        count={DIY_SITES.length}
      />
      <div className="board inspiration-list">
        {DIY_SITES.map(site => (
          <a key={site.url} href={site.url} target="_blank" rel="noopener noreferrer" className="board-row">
            <span>
              <strong>{site.name}</strong>
              <small>{site.tagline}</small>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
        ))}
      </div>
      {import.meta.env.VITE_SHOPKEEP_URL && (
        <a
          href={import.meta.env.VITE_SHOPKEEP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="companion-link"
        >
          <Boxes size={19} aria-hidden="true" />
          <span><strong>Shopkeep</strong><small>Open tool inventory</small></span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

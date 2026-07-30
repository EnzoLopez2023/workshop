import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Boxes, ArrowUpRight, Hammer, Cpu, Plus, Copy, Trash2, LayoutTemplate } from 'lucide-react';
import { listProjects, listShaperProjects, listTemplates, cloneTemplate, deleteTemplate, imageUrl } from '../services/api';
import type { ProjectListItem, ProjectStatus, ShaperProject, TemplateListItem } from '../types/project';
import ProjectCard from '../components/ProjectCard';
import ShaperProjectCard from '../components/ShaperProjectCard';
import SplitFlap from '../components/SplitFlap';
import { ProjectCardSkeleton } from '../components/Skeleton';

type StatusFilter = 'all' | ProjectStatus;

// The board keeps its own time, the way one in a concourse does.
function boardClock(d: Date) {
  const day = d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${date} · ${time}`;
}

const DIY_SITES = [
  { name: 'Kreg Tool Plans',       tagline: 'Pocket-hole projects & free plans',  url: 'https://learn.kregtool.com/projects-plans/' },
  { name: 'Shanty 2 Chic',         tagline: 'Farmhouse builds on a budget',       url: 'https://www.shanty-2-chic.com/' },
  { name: 'Ana White',             tagline: 'Free plans for every skill level',   url: 'https://www.ana-white.com/' },
  { name: 'Houseful of Handmade',  tagline: 'Modern DIY furniture & home decor',  url: 'https://housefulofhandmade.com/' },
];

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'idea',        label: 'Ideas' },
  { key: 'planning',    label: 'Planning' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects,       setProjects]       = useState<ProjectListItem[]>([]);
  const [shaperProjects, setShaperProjects] = useState<ShaperProject[]>([]);
  const [templates,      setTemplates]      = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);
  const [clock, setClock] = useState(() => boardClock(new Date()));

  useEffect(() => {
    const t = setInterval(() => setClock(boardClock(new Date())), 20_000);
    return () => clearInterval(t);
  }, []);

  const loadTemplates = () => listTemplates().then(setTemplates).catch(console.error);

  useEffect(() => {
    setLoading(true);
    Promise.all([listProjects(), listShaperProjects(), listTemplates()])
      .then(([p, s, t]) => { setProjects(p); setShaperProjects(s); setTemplates(t); })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleUseTemplate = async (id: number) => {
    setCloningId(id);
    try {
      const project = await cloneTemplate(id);
      navigate(`/projects/${project.id}`);
    } catch (err) { console.error(err); }
    setCloningId(null);
  };

  const handleDeleteTemplate = async (id: number) => {
    try { await deleteTemplate(id); loadTemplates(); }
    catch (err) { console.error(err); }
  };

  const counts = useMemo(() => ({
    inProgress: projects.filter(p => p.status === 'in_progress').length,
    queued: projects.filter(p => p.status === 'idea' || p.status === 'planning').length,
    parts: projects.filter(p => p.status !== 'completed').reduce((s, p) => s + (p.parts_count || 0), 0),
    value: projects.reduce((s, p) => s + (p.total_cost || 0), 0).toFixed(0),
  }), [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter(p => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!q) return true;
      const hay = `${p.title} ${p.description ?? ''} ${p.wood_types.join(' ')} ${p.cut_list_names ?? ''} ${p.material_names ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [projects, filter, search]);

  return (
    <div className="page-container">
      {/* The board */}
      <motion.section
        style={{ marginBottom: 34 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="board">
          <div className="rail riveted" style={{ paddingLeft: 26, paddingRight: 26 }}>
            <span>Shop Board</span>
            <span className="rail-count" style={{ letterSpacing: '0.12em' }}>{clock}</span>
          </div>
          <div className="dash-board">
            <DashCell
              label="In Progress"
              value={loading ? '' : String(counts.inProgress).padStart(2, '0')}
              sub="active builds"
              tone="amber"
            />
            <DashCell
              label="In Queue"
              value={loading ? '' : String(counts.queued).padStart(2, '0')}
              sub="ideas & plans"
            />
            <DashCell
              label="Total Parts"
              value={loading ? '' : String(counts.parts).padStart(3, '0')}
              sub="across active projects"
              minCells={3}
            />
            <DashCell
              label="Est. Value"
              value={loading ? '' : `$${counts.value}`}
              sub="in materials"
              minCells={4}
              tone="green"
            />
          </div>
        </div>
      </motion.section>

      {/* Search + filters */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 24, flexWrap: 'wrap',
      }}>
        <div style={{ position: 'relative', flex: '1 1 340px', maxWidth: 460 }}>
          <Search
            size={15}
            style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-muted)',
            }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects, wood types…"
            style={{ paddingLeft: 36 }}
          />
        </div>

        <div className="filter-strip">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="rail" style={{ marginBottom: 16 }}>
        <Boxes size={13} strokeWidth={2.2} />
        <span>Projects</span>
        <span className="rail-count">{loading ? '—' : String(filtered.length).padStart(2, '0')}</span>
      </div>
      {loading ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 22,
        }}>
          {[0, 1, 2, 3, 4, 5].map(i => <ProjectCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          {projects.length === 0
            ? 'No projects yet. Start by capturing your first idea.'
            : 'No projects match those filters.'}
        </div>
      ) : (
        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
        >
          {filtered.map(p => (
            <motion.div
              key={p.id}
              variants={{
                hidden: { opacity: 0, y: 14 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
              }}
            >
              <ProjectCard project={p} onClick={() => navigate(`/projects/${p.id}`)} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Shaper Hub section */}
      <div style={{ marginTop: 56 }}>
        <div className="rail" style={{ marginBottom: 16 }}>
          <Cpu size={13} strokeWidth={2.2} />
          <span>Shaper Tools Hub — CNC</span>
          <span className="rail-count">{String(shaperProjects.length).padStart(2, '0')}</span>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/shaper/new')}
            style={{
              marginLeft: 14, minHeight: 24, padding: '4px 8px',
              color: 'var(--color-on-steel)', borderColor: 'rgba(237,241,238,0.3)',
            }}
          >
            <Plus size={12} /> Add
          </button>
        </div>

        {loading ? null : shaperProjects.length === 0 ? (
          <div className="card empty-state" style={{ padding: '28px 24px', fontSize: '0.88rem' }}>
            No Shaper Hub projects yet.{' '}
            <button
              onClick={() => navigate('/shaper/new')}
              className="text-amber"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
            >
              Add your first one
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 18,
          }}>
            {shaperProjects.map(p => (
              <ShaperProjectCard key={p.id} project={p} onClick={() => navigate(`/shaper/${p.id}`)} />
            ))}
          </div>
        )}
      </div>

      {/* Templates section */}
      {templates.length > 0 && (
        <div style={{ marginTop: 56 }}>
          <div className="rail" style={{ marginBottom: 16 }}>
            <LayoutTemplate size={13} strokeWidth={2.2} />
            <span>Project Templates</span>
            <span className="rail-count">{String(templates.length).padStart(2, '0')}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {templates.map(t => (
              <div key={t.id} className="card depart-card">
                {t.hero_image_id && (
                  <span className="depart-photo">
                    <img src={imageUrl(t.hero_image_id)} alt="" />
                  </span>
                )}
                <span className="depart-head">
                  <span className="board-caps depart-title">{t.template_name || t.title}</span>
                  <span className="pill flag-idle">{t.difficulty}</span>
                </span>
                <span className="depart-foot" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>
                    <span className="stat-label">Parts</span>
                    <span className="readout">{String(t.parts_count).padStart(2, '0')}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px' }}>
                    <button
                      className="btn btn-muted"
                      onClick={() => handleUseTemplate(t.id)}
                      disabled={cloningId === t.id}
                      style={{ minHeight: 30, padding: '6px 10px' }}
                    >
                      <Copy size={12} />
                      {cloningId === t.id ? 'Creating…' : 'Use'}
                    </button>
                    {confirmDeleteTemplateId === t.id ? (
                      <>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setConfirmDeleteTemplateId(null)}
                          style={{ minHeight: 30, padding: '6px 8px' }}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => { handleDeleteTemplate(t.id); setConfirmDeleteTemplateId(null); }}
                          style={{ minHeight: 30, padding: '6px 8px', color: 'var(--color-red)' }}
                          aria-label="Confirm delete template"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmDeleteTemplateId(t.id)}
                        style={{ minHeight: 30, padding: '6px 8px', color: 'var(--color-muted)' }}
                        aria-label="Delete template"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DIY site links */}
      <div style={{ marginTop: 56 }}>
        <div className="board">
          <div className="rail">
            <Hammer size={13} strokeWidth={2.2} />
            <span>Build Inspiration</span>
            <span className="rail-count">{String(DIY_SITES.length).padStart(2, '0')}</span>
          </div>
          {DIY_SITES.map(site => (
            <a
              key={site.url}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="board-row"
            >
              <span className="board-caps" style={{ flex: '0 0 auto', minWidth: 190 }}>{site.name}</span>
              <span className="muted" style={{ fontSize: '0.82rem', flex: 1 }}>{site.tagline}</span>
              <ArrowUpRight size={15} className="muted" style={{ flexShrink: 0 }} />
            </a>
          ))}
        </div>
      </div>

      {/* Companion app — only shown when VITE_SHOPKEEP_URL is configured */}
      {import.meta.env.VITE_SHOPKEEP_URL && (
        <div style={{ marginTop: 56, display: 'flex', justifyContent: 'center' }}>
          <a
            href={import.meta.env.VITE_SHOPKEEP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 14,
              padding: '14px 20px',
              textDecoration: 'none',
              color: 'var(--color-ink)',
            }}
          >
            <div
              style={{
                width: 34, height: 34, borderRadius: 'var(--r-flap)',
                background: 'var(--steel-face)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Boxes size={17} color="var(--color-on-steel)" strokeWidth={2.2} />
            </div>
            <div style={{ lineHeight: 1.3 }}>
              <div className="stat-label" style={{ marginBottom: 2 }}>Companion App</div>
              <div className="board-caps" style={{ fontSize: '0.86rem' }}>
                Shopkeep — tool inventory
              </div>
            </div>
            <ArrowUpRight size={17} className="muted" strokeWidth={2} />
          </a>
        </div>
      )}
    </div>
  );
}

function DashCell({
  label, value, sub, minCells = 2, tone = 'ink',
}: {
  label: string;
  value: string;
  sub: string;
  minCells?: number;
  tone?: 'ink' | 'amber' | 'green';
}) {
  return (
    <div className="dash-cell">
      <div className="stat-label">{label}</div>
      <SplitFlap
        value={value}
        cells={Math.max(minCells, value.length)}
        tone={tone}
        label={value ? `${label}: ${value}` : `${label}: loading`}
      />
      <div className="dash-cell-sub">{sub}</div>
    </div>
  );
}

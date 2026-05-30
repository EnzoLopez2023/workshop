import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, Boxes, ArrowUpRight, Hammer, Cpu, Plus, Copy, Trash2, LayoutTemplate } from 'lucide-react';
import { listProjects, listShaperProjects, listTemplates, cloneTemplate, deleteTemplate, imageUrl } from '../services/api';
import type { ProjectListItem, ProjectStatus, ShaperProject, TemplateListItem } from '../types/project';
import ProjectCard from '../components/ProjectCard';
import ShaperProjectCard from '../components/ShaperProjectCard';
import { ProjectCardSkeleton } from '../components/Skeleton';

type StatusFilter = 'all' | ProjectStatus;

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
      {/* Hero */}
      <motion.div
        style={{ marginBottom: 40 }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <span
          className="pill"
          style={{
            backgroundColor: 'var(--color-cream-2)',
            color: 'var(--color-ink-soft)',
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: '0.75rem' }}>◆</span>
          Your Workshop Journal
        </span>
        <h1 style={{
          fontFamily: 'var(--font-serif)', margin: '14px 0 18px',
          fontSize: 'clamp(2.4rem, 5vw, 3.6rem)', fontWeight: 700,
          lineHeight: 1.08, color: 'var(--color-ink)', letterSpacing: '-0.02em',
        }}>
          Every project,
          <br />
          <span style={{ fontStyle: 'italic', color: 'var(--color-rust)', fontWeight: 600 }}>
            from sketch to sawdust.
          </span>
        </h1>
        <p style={{
          maxWidth: 560, margin: 0, color: 'var(--color-muted)',
          fontSize: '1rem', lineHeight: 1.55,
        }}>
          Capture ideas, gather inspiration, plan your cuts, and keep every detail of your
          woodworking projects in one considered place.
        </p>
      </motion.div>

      {/* Search + filters */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 28, flexWrap: 'wrap',
      }}>
        <div style={{ position: 'relative', flex: '1 1 360px', maxWidth: 500 }}>
          <Search
            size={16}
            style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--color-muted)',
            }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects, wood types…"
            style={{
              paddingLeft: 42,
              borderRadius: 999,
              backgroundColor: 'var(--color-paper)',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="btn"
                style={{
                  backgroundColor: active ? 'var(--color-ink-soft)' : 'var(--color-cream-2)',
                  color: active ? 'var(--color-cream)' : 'var(--color-ink)',
                  padding: '8px 16px',
                  fontSize: '0.82rem',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
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
      <div style={{ marginTop: 64 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Cpu size={15} className="text-rust" />
            <span className="eyebrow">Shaper Tools Hub — CNC Projects</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/shaper/new')}
            style={{ fontSize: '0.8rem', gap: 6 }}
          >
            <Plus size={13} /> Add Project
          </button>
        </div>

        {loading ? null : shaperProjects.length === 0 ? (
          <div className="card empty-state" style={{ padding: '28px 24px', fontSize: '0.88rem' }}>
            No Shaper Hub projects yet.{' '}
            <button
              onClick={() => navigate('/shaper/new')}
              className="text-rust"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
            >
              Add your first one →
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
        <div style={{ marginTop: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LayoutTemplate size={15} className="text-rust" />
              <span className="eyebrow">Project Templates</span>
              <span className="muted" style={{ fontSize: '0.72rem', fontWeight: 600, background: 'var(--color-cream-2)', padding: '2px 8px', borderRadius: 99 }}>
                {templates.length}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {templates.map(t => (
              <div key={t.id} className="card" style={{ overflow: 'hidden' }}>
                {t.hero_image_id ? (
                  <img src={imageUrl(t.hero_image_id)} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ height: 80, background: 'var(--color-cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LayoutTemplate size={28} className="muted" style={{ opacity: 0.5 }} />
                  </div>
                )}
                <div style={{ padding: '14px 16px' }}>
                  <div className="font-serif" style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>{t.template_name || t.title}</div>
                  <div className="muted" style={{ fontSize: '0.76rem', marginBottom: 12 }}>
                    {t.difficulty} · {t.parts_count} part{t.parts_count !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleUseTemplate(t.id)}
                      disabled={cloningId === t.id}
                      style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                    >
                      <Copy size={13} />
                      {cloningId === t.id ? 'Creating…' : 'Use Template'}
                    </button>
                    {confirmDeleteTemplateId === t.id ? (
                      <>
                        <button className="btn btn-ghost" onClick={() => setConfirmDeleteTemplateId(null)} style={{ padding: '8px 10px', fontSize: '0.78rem' }}>
                          Cancel
                        </button>
                        <button className="btn btn-ghost" onClick={() => { handleDeleteTemplate(t.id); setConfirmDeleteTemplateId(null); }} style={{ padding: '8px 10px', color: 'var(--color-rust)' }}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmDeleteTemplateId(t.id)}
                        style={{ padding: '8px 10px', color: 'var(--color-muted)' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DIY site links */}
      <div style={{ marginTop: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Hammer size={15} className="text-rust" />
          <span className="eyebrow">Build Inspiration — Where the Sawdust Starts</span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}>
          {DIY_SITES.map(site => (
            <a
              key={site.url}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card card-hover"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '14px 18px',
                textDecoration: 'none', color: 'var(--color-ink)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{site.name}</div>
                <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>{site.tagline}</div>
              </div>
              <ArrowUpRight size={15} className="muted" style={{ flexShrink: 0 }} />
            </a>
          ))}
        </div>
      </div>

      {/* Companion app — only shown when VITE_SHOPKEEP_URL is configured */}
      {import.meta.env.VITE_SHOPKEEP_URL && (
        <div style={{ marginTop: 64, display: 'flex', justifyContent: 'center' }}>
          <a
            href={import.meta.env.VITE_SHOPKEEP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="card card-hover"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 14,
              padding: '14px 22px',
              textDecoration: 'none',
              color: 'var(--color-ink)',
              backgroundColor: 'var(--color-cream-2)',
            }}
          >
            <div
              style={{
                width: 36, height: 36, borderRadius: 9,
                backgroundColor: 'var(--color-ink-soft)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Boxes size={18} color="var(--color-cream)" strokeWidth={2.2} />
            </div>
            <div style={{ lineHeight: 1.25 }}>
              <div className="muted" style={{ fontSize: '0.68rem', letterSpacing: '0.14em', fontWeight: 600 }}>
                COMPANION APP
              </div>
              <div className="font-serif" style={{ fontWeight: 700, fontSize: '1rem' }}>
                Shopkeep — your tool inventory
              </div>
            </div>
            <ArrowUpRight size={18} className="muted" strokeWidth={2} />
          </a>
        </div>
      )}
    </div>
  );
}

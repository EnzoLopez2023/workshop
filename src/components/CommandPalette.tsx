import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, LayoutDashboard, Plus, ShoppingCart, Ruler,
  BookOpen, Settings, Hammer, Cpu,
} from 'lucide-react';
import { listProjects } from '../services/api';
import type { ProjectListItem } from '../types/project';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Fetch projects once when first opened
  useEffect(() => {
    if (!open || loaded) return;
    listProjects()
      .then(p => { setProjects(p); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  const go = useCallback((path: string) => {
    navigate(path);
    onClose();
  }, [navigate, onClose]);

  // Close on Escape (cmdk handles this via Command, but also handle backdrop)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              backgroundColor: 'rgba(10, 6, 3, 0.55)',
              backdropFilter: 'blur(3px)',
            }}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed', top: '18vh', left: '50%',
              transform: 'translateX(-50%)',
              width: '90vw', maxWidth: 580,
              zIndex: 1001,
              borderRadius: 3,
              border: '1px solid var(--color-line)',
              background: 'var(--color-flap)',
              boxShadow: '0 32px 80px rgba(0,0,0,0.28)',
              overflow: 'hidden',
            }}
          >
            <Command
              style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-ui)' }}
              shouldFilter={true}
            >
              {/* Search input row */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 16px',
                borderBottom: '1px solid var(--color-line)',
              }}>
                <Search size={17} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />
                <Command.Input
                  autoFocus
                  placeholder="Search projects, navigate…"
                  style={{
                    flex: 1, border: 'none', outline: 'none',
                    background: 'transparent',
                    fontSize: '0.95rem', color: 'var(--color-ink)',
                    fontFamily: 'var(--font-ui)',
                    padding: 0,
                  }}
                />
                <kbd style={{
                  fontSize: '0.68rem', fontFamily: 'var(--font-ui)',
                  color: 'var(--color-muted)',
                  background: 'var(--color-flap-shade)',
                  border: '1px solid var(--color-line)',
                  borderRadius: 5, padding: '2px 6px',
                  flexShrink: 0,
                }}>
                  ESC
                </kbd>
              </div>

              {/* Results list */}
              <Command.List style={{
                maxHeight: '60vh',
                overflowY: 'auto',
                padding: '8px 0',
              }}>
                <Command.Empty style={{
                  padding: '20px 16px',
                  textAlign: 'center',
                  color: 'var(--color-muted)',
                  fontSize: '0.88rem',
                }}>
                  No results found.
                </Command.Empty>

                {/* Navigation */}
                <PaletteGroup heading="Navigate">
                  <PaletteItem icon={<LayoutDashboard size={15} />} label="Dashboard" onSelect={() => go('/')} />
                  <PaletteItem icon={<Plus size={15} />} label="New Project" onSelect={() => go('/projects/new')} />
                  <PaletteItem icon={<ShoppingCart size={15} />} label="Shopping List" onSelect={() => go('/shopping-list')} />
                  <PaletteItem icon={<Ruler size={15} />} label="Conversions" onSelect={() => go('/conversions')} />
                  <PaletteItem icon={<BookOpen size={15} />} label="Notebook" onSelect={() => go('/notebook')} />
                  <PaletteItem icon={<Cpu size={15} />} label="Add Shaper Hub Project" onSelect={() => go('/shaper/new')} />
                  <PaletteItem icon={<Settings size={15} />} label="Settings" onSelect={() => go('/settings')} />
                </PaletteGroup>

                {/* Projects */}
                {projects.length > 0 && (
                  <PaletteGroup heading="Projects">
                    {projects.map(p => (
                      <PaletteItem
                        key={p.id}
                        icon={<Hammer size={15} />}
                        label={p.title}
                        sub={p.status.replace('_', ' ')}
                        onSelect={() => go(`/projects/${p.id}`)}
                      />
                    ))}
                  </PaletteGroup>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function PaletteGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      style={{ padding: '0 8px' }}
    >
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em',
        color: 'var(--color-muted)', textTransform: 'uppercase',
        padding: '8px 8px 4px',
      }}>
        {heading}
      </div>
      {children}
    </Command.Group>
  );
}

function PaletteItem({ icon, label, sub, onSelect }: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px', borderRadius: 3,
        cursor: 'pointer', fontSize: '0.9rem',
        color: 'var(--color-ink)',
      }}
    >
      <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {sub && (
        <span style={{
          fontSize: '0.72rem', color: 'var(--color-muted)',
          background: 'var(--color-flap-shade)',
          padding: '2px 8px', borderRadius: 2,
          textTransform: 'capitalize',
        }}>
          {sub}
        </span>
      )}
    </Command.Item>
  );
}

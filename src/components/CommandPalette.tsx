import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Search, LayoutDashboard, Plus, ShoppingCart, Ruler,
  BookOpen, Settings, Hammer, Cpu, Box,
} from 'lucide-react';
import { listProjects } from '../services/api';
import type { ProjectListItem } from '../types/project';

interface Props {
  open: boolean;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}

export default function CommandPalette({ open, onClose, returnFocusTo }: Props) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const backgroundElements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-command-background]'),
    );
    const previousInert = backgroundElements.map(element => element.inert);
    backgroundElements.forEach(element => { element.inert = true; });

    return () => {
      backgroundElements.forEach((element, index) => {
        element.inert = previousInert[index] ?? false;
      });
      if (returnFocusTo?.isConnected) {
        returnFocusTo.focus();
      } else {
        document.getElementById('main-content')?.focus();
      }
    };
  }, [open, returnFocusTo]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

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
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            onClick={onClose}
            className="command-backdrop"
          />

          <motion.div
            ref={panelRef}
            key="panel"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search and navigate"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <Command
              className="command-root"
              shouldFilter={true}
            >
              <div className="command-search">
                <Search size={18} aria-hidden="true" />
                <Command.Input
                  autoFocus
                  aria-label="Search projects and destinations"
                  placeholder="Search projects, navigate…"
                  className="command-input"
                />
                <kbd className="command-key">Esc</kbd>
              </div>

              <Command.List className="command-list">
                <Command.Empty className="command-empty">
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
                  <PaletteItem icon={<Box size={15} />} label="Add Bambu Hub Project" onSelect={() => go('/bambu/new')} />
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
      className="command-group"
    >
      <div className="command-group-label">{heading}</div>
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
      className="command-item"
    >
      <span className="command-item-icon" aria-hidden="true">{icon}</span>
      <span className="command-item-label">{label}</span>
      {sub && <span className="command-item-state">{sub}</span>}
    </Command.Item>
  );
}

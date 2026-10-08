import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderPlus, LayoutGrid, Trash2 } from 'lucide-react';
import { Button, IconButton, PageFrame, PageHeader, StatePanel } from '../components/ui';
import { createBuiltinProject, deleteBuiltinProject, listBuiltinProjects } from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import type { BuiltinProjectSummary } from '../types/project';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; projects: BuiltinProjectSummary[] };

const message = (err: unknown) => (err instanceof Error && err.message ? err.message : 'the request failed');

function updatedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Built-in Studio projects: groups of saved cabinet designs, optionally laid out in a room. */
export default function BuiltinProjects() {
  const navigate = useNavigate();
  const demo = isDemoMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBuiltinProjects()
      .then(projects => !cancelled && setLoad({ state: 'ready', projects }))
      .catch(err => !cancelled && setLoad({ state: 'error', message: message(err) }));
    return () => { cancelled = true; };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createBuiltinProject(name.trim());
      navigate(`/built-ins/projects/${project.id}`);
    } catch (err) {
      setError(`The project wasn’t created: ${message(err)}`);
      setBusy(false);
    }
  };

  const remove = async (project: BuiltinProjectSummary) => {
    setError(null);
    try {
      await deleteBuiltinProject(project.id);
      setLoad(prev => (prev.state === 'ready' ? { state: 'ready', projects: prev.projects.filter(p => p.id !== project.id) } : prev));
    } catch (err) {
      setError(`“${project.name}” wasn’t deleted: ${message(err)}`);
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <PageFrame maxWidth={1100} className="builtin-projects-page">
      <Button variant="ghost" onClick={() => navigate('/built-ins')} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" /> Built-in Studio
      </Button>
      <PageHeader
        title="Built-in projects"
        description="Group the cabinets you design into a project, sketch the room they go in, drag them into place, then walk around it in 3D."
      />

      {!demo && (
        <form className="card builtin-new-project" onSubmit={create}>
          <label className="form-field">
            <span className="form-field-label">New project</span>
            <input value={name} maxLength={120} placeholder="Kitchen pantry, living room wall…" onChange={e => setName(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
            <FolderPlus size={16} aria-hidden="true" /> {busy ? 'Creating…' : 'Create project'}
          </Button>
        </form>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}

      {load.state === 'loading' && <p className="is-muted" role="status">Loading your projects…</p>}
      {load.state === 'error' && <StatePanel tone="danger" title="Projects couldn’t be loaded" description={load.message} />}
      {load.state === 'ready' && load.projects.length === 0 && (
        <StatePanel
          title="No built-in projects yet"
          description={demo ? 'Sign in to group your built-in designs into projects.' : 'Name one above, then add the cabinets you’ve saved in the Built-in Studio.'}
        />
      )}
      {load.state === 'ready' && load.projects.length > 0 && (
        <ul className="builtin-project-list">
          {load.projects.map(p => (
            <li key={p.id} className="card builtin-project-card">
              <Link to={`/built-ins/projects/${p.id}`} className="builtin-project-link">
                <LayoutGrid size={20} aria-hidden="true" />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.cabinet_count} cabinet{p.cabinet_count === 1 ? '' : 's'}
                    {p.has_room ? ` · room set up · ${p.placed_count} placed` : ' · no room yet'}
                    {updatedOn(p.updated_at) && ` · ${updatedOn(p.updated_at)}`}
                  </small>
                </span>
              </Link>
              {!demo && (confirmDelete === p.id ? (
                <span className="builtin-confirm">
                  <Button variant="danger" onClick={() => remove(p)}>Delete</Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep</Button>
                </span>
              ) : (
                <IconButton label={`Delete ${p.name}`} onClick={() => setConfirmDelete(p.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              ))}
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, PageFrame, PageHeader, StatePanel } from '../components/ui';
import { isDemoMode } from '../demo/demoMode';
import { formatRelativeTime } from '../lib/notebook';
import { listTabloomWorkshopPages, type TabloomPageSummary } from '../services/tabloomApi';

export default function NotebookList() {
  const navigate = useNavigate();
  const demo = isDemoMode();
  const [pages, setPages] = useState<TabloomPageSummary[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setLoadError(null);
    try {
      setPages(await listTabloomWorkshopPages());
    } catch (error) {
      console.error('Notebook load failed', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const description = demo
    ? 'Notebook connects to Tabloom for signed-in workspaces.'
    : loading
      ? 'Loading the Workshop notebook from Tabloom.'
      : `${pages.length} page${pages.length === 1 ? '' : 's'} synced with Tabloom.`;

  return (
    <PageFrame maxWidth={920} className="notebook-list-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Notebook"
        description={description}
        actions={!demo && (
          <Button variant="primary" onClick={() => navigate('/notebook/new')}>
            <Plus size={17} aria-hidden="true" />
            New page
          </Button>
        )}
      />

      {demo ? (
        <StatePanel
          title="Notebook needs a signed-in workspace"
          description="The demo remains read only and does not connect to a personal Tabloom notebook."
        />
      ) : loading ? (
        <NotebookListSkeleton />
      ) : loadError === 'workshop_notebook_missing' ? (
        <StatePanel
          title="Workshop notebook not found"
          description='Create a notebook named "Workshop" in Tabloom, then return here to open it.'
          action={<Button onClick={() => void loadPages()}>Check again</Button>}
        />
      ) : loadError ? (
        <StatePanel
          title="Notebook unavailable"
          description={`Workshop could not load pages from Tabloom: ${loadError}`}
          tone="danger"
          action={<Button onClick={() => void loadPages()}>Try again</Button>}
        />
      ) : pages.length === 0 ? (
        <StatePanel
          title="Start the first notebook page"
          description="Create a Markdown page here and it will be stored in the Workshop notebook in Tabloom."
          action={
            <Button variant="primary" onClick={() => navigate('/notebook/new')}>
              <Plus size={17} aria-hidden="true" />
              New page
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="notebook-pages-title">
          <div className="rail notebook-list-rail">
            <span id="notebook-pages-title"><BookOpen size={17} aria-hidden="true" /> Pages</span>
            <span className="rail-count">{pages.length}</span>
          </div>
          <div className="notebook-page-list">
            {pages.map(page => (
              <Link className="notebook-page-row" to={`/notebook/${page.id}`} key={page.id}>
                <span className="notebook-page-copy">
                  <strong>{page.title || 'Untitled'}</strong>
                  {page.snippet && <span>{page.snippet}</span>}
                  <time dateTime={page.edited_at}>Edited {formatRelativeTime(page.edited_at)}</time>
                </span>
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
}

function NotebookListSkeleton() {
  return (
    <div
      className="notebook-page-list"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading notebook pages"
    >
      {[0, 1, 2].map(index => (
        <div className="notebook-page-row is-skeleton" aria-hidden="true" key={index}>
          <span className="notebook-skeleton-title skeleton" />
          <span className="notebook-skeleton-copy skeleton" />
        </div>
      ))}
    </div>
  );
}

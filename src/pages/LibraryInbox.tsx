import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Archive, ArrowLeft, Box, CheckCircle2, ChevronRight, Star } from 'lucide-react';
import { libraryThumbUrl, listLibraryModels, updateLibraryModel } from '../services/api';
import type { LibraryModel, LibraryStatus } from '../types/project';
import { categoryLabel, formatDimensions, formatDuration, formatGrams } from '../lib/library';
import { libraryHelper, useLibraryHelper } from '../lib/libraryHelper';
import { Button, PageFrame, PageHeader, StatePanel } from '../components/ui';

/**
 * One model at a time: decide what it is (want / printed / archive) and where
 * it lives (a category). Number keys file into categories; W/P/A set status;
 * → skips.
 */
export default function LibraryInbox() {
  const helper = useLibraryHelper();
  const [queue, setQueue] = useState<LibraryModel[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const load = useCallback(async () => {
    const page = await listLibraryModels({ status: 'inbox', sort: 'recent', limit: 200 });
    setQueue(page.items);
  }, []);

  useEffect(() => {
    void load().catch(() => setQueue([]));
  }, [load]);

  useEffect(() => {
    if (!helper.available) return;
    libraryHelper.categories()
      .then(r => setCategories(r.categories.filter(c => !c.startsWith('_'))))
      .catch(() => undefined);
  }, [helper.available]);

  const current = queue?.[0] ?? null;

  const next = useCallback(() => {
    setQueue(q => (q ? q.slice(1) : q));
    setDone(n => n + 1);
  }, []);

  const decide = useCallback(async (status: LibraryStatus | null, category?: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (category && helper.available) await libraryHelper.file(current.id, category, status ?? undefined);
      // Status also goes through Workshop so it applies even when the helper is unavailable.
      if (status) await updateLibraryModel(current.id, { status });
      next();
    } catch (err) {
      toast.error('Could not file this model', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }, [busy, current, helper.available, next]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 'w') void decide('want');
      else if (key === 'p') void decide('printed');
      else if (key === 'a') void decide('skip', '_Archive');
      else if (key === 'arrowright') next();
      else if (/^[1-9]$/.test(key) && categories[Number(key) - 1]) void decide('want', categories[Number(key) - 1]);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [categories, decide, next]);

  return (
    <PageFrame maxWidth={1000} className="library-inbox">
      <Link to="/" className="library-back"><ArrowLeft size={16} aria-hidden="true" /> Library</Link>
      <PageHeader
        title="Inbox"
        description="Decide what each new model is for. Choosing a category moves its folder there; everything is undoable from Organize → History."
      />

      {queue === null ? (
        <p className="page-sub" role="status">Loading inbox…</p>
      ) : !current ? (
        <StatePanel
          title={done ? `Inbox zero — ${done} model${done === 1 ? '' : 's'} triaged` : 'Inbox is empty'}
          description="New downloads land here automatically."
          action={<Link className="btn btn-muted" to="/">Back to Library</Link>}
        />
      ) : (
        <article className="library-triage card" aria-live="polite">
          <div className="library-triage-media">
            {current.thumb_hash
              ? <img src={libraryThumbUrl(current.thumb_hash)} alt={`${current.title} preview`} />
              : <span className="bambu-card-placeholder" aria-hidden="true"><Box size={64} strokeWidth={1.2} /></span>}
          </div>
          <div className="library-triage-body">
            <p className="library-triage-progress">{queue.length} left{done ? ` · ${done} done` : ''}</p>
            <h2 className="library-triage-title">
              <Link to={`/library/${current.id}`}>{current.title}</Link>
            </h2>
            <p className="library-triage-meta">
              {[current.designer && `by ${current.designer}`, current.formats.join(', ').toUpperCase(), formatDimensions(current.bbox),
                current.est_seconds ? `${formatDuration(current.est_seconds)} · ${formatGrams(current.est_grams)}` : null]
                .filter(Boolean).join(' · ')}
            </p>

            <div className="library-triage-actions">
              <Button variant="primary" disabled={busy} onClick={() => void decide('want')}>
                <Star size={16} aria-hidden="true" /> Want to print <kbd>W</kbd>
              </Button>
              <Button disabled={busy} onClick={() => void decide('printed')}>
                <CheckCircle2 size={16} aria-hidden="true" /> Already printed <kbd>P</kbd>
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void decide('skip', '_Archive')}>
                <Archive size={16} aria-hidden="true" /> Archive <kbd>A</kbd>
              </Button>
              <Button variant="ghost" disabled={busy} onClick={next}>
                Skip for now <ChevronRight size={16} aria-hidden="true" /> <kbd>→</kbd>
              </Button>
            </div>

            <div className="library-triage-categories">
              <span className="stat-label">File into category (sets Want to print)</span>
              {helper.available ? (
                <div className="library-category-grid">
                  {categories.map((c, i) => (
                    <Button key={c} disabled={busy} onClick={() => void decide('want', c)}>
                      {i < 9 && <kbd>{i + 1}</kbd>} {categoryLabel(c)}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="library-hint">Moving folders needs the Library helper on your Mac. Status changes still save here.</p>
              )}
            </div>
          </div>
        </article>
      )}
    </PageFrame>
  );
}

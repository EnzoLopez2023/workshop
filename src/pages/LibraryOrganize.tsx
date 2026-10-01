import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Box, FolderInput, History, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { getLibraryOverview, getLibraryPlan, libraryThumbUrl } from '../services/api';
import type { LibraryBatch, LibraryPlan, LibraryPlanModel } from '../types/project';
import { LIBRARY_STATUS_LABELS } from '../types/project';
import { LIBRARY_STATUS_TONE, categoryLabel, formatBytes, relativeDate } from '../lib/library';
import { libraryHelper, useLibraryHelper } from '../lib/libraryHelper';
import { Button, PageFrame, PageHeader, SectionRail, StatePanel } from '../components/ui';

export default function LibraryOrganize() {
  const helper = useLibraryHelper();
  const [plan, setPlan] = useState<LibraryPlan | null | undefined>(undefined);
  const [batches, setBatches] = useState<LibraryBatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextPlan, overview] = await Promise.all([getLibraryPlan(), getLibraryOverview()]);
    setPlan(nextPlan);
    setBatches(overview.batches);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    void load().catch(() => setPlan(null));
  }, [load]);

  useEffect(() => {
    if (helper.available) libraryHelper.batches().then(r => setBatches(r.batches)).catch(() => undefined);
  }, [helper.available]);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryPlanModel[]>();
    for (const m of plan?.models ?? []) {
      const key = m.dest ? m.category : 'Duplicates only';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return [...map.entries()].sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0])));
  }, [plan]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected(current => {
      const next = new Set(current);
      for (const id of ids) (on ? next.add(id) : next.delete(id))
      return next;
    });

  const refresh = async () => {
    setWorking('Rescanning your library…');
    try {
      await libraryHelper.sync();
      await load();
    } catch (err) {
      toast.error('Rescan failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setWorking(null);
    }
  };

  const apply = async () => {
    const ids = [...selected];
    setWorking(`Organizing ${ids.length} model${ids.length === 1 ? '' : 's'}…`);
    try {
      const result = await libraryHelper.applyPlan(ids);
      const failed = result.results.filter(r => !r.ok);
      if (failed.length) {
        toast.warning(`${ids.length - failed.length} organized, ${failed.length} skipped`, {
          description: failed.slice(0, 3).map(f => `${f.title}: ${f.error}`).join('\n'),
        });
      } else {
        toast.success(`Organized ${ids.length} model${ids.length === 1 ? '' : 's'}`, {
          action: { label: 'Undo', onClick: () => void undo(result.batch) },
        });
      }
      setWorking('Updating Workshop…');
      await libraryHelper.sync();
      await load();
      libraryHelper.batches().then(r => setBatches(r.batches)).catch(() => undefined);
    } catch (err) {
      toast.error('Organizing failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setWorking(null);
    }
  };

  const undo = async (batch: string) => {
    if (!window.confirm('Put every file from this batch back where it was?')) return;
    setWorking('Undoing…');
    try {
      const { reversed } = await libraryHelper.undo(batch);
      toast.success(`Reversed ${reversed} operations`);
      await libraryHelper.sync();
      await load();
      libraryHelper.batches().then(r => setBatches(r.batches)).catch(() => undefined);
    } catch (err) {
      toast.error('Undo failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setWorking(null);
    }
  };

  const s = plan?.summary;
  const allIds = plan?.models.map(m => m.id) ?? [];

  return (
    <PageFrame className="library-organize">
      <Link to="/" className="library-back"><ArrowLeft size={16} aria-hidden="true" /> Library</Link>
      <PageHeader
        title="Organize"
        description="Every model gets its own folder inside a category. Downloads go to Inbox. Exact duplicate copies go to the Trash, where you can still recover them."
        actions={helper.available
          ? <Button onClick={() => void refresh()} disabled={Boolean(working)}><RefreshCw size={16} aria-hidden="true" /> Rescan</Button>
          : undefined}
      />

      {!helper.available && !helper.checking && (
        <StatePanel
          title="Open this page on your Mac to apply changes"
          description="The plan below is read-only here. Applying it needs the Library helper (workshop-library serve), which runs on the Mac that holds the files."
        />
      )}

      {plan === undefined ? (
        <p className="page-sub" role="status">Loading plan…</p>
      ) : !plan || plan.models.length === 0 ? (
        <StatePanel title="Everything is organized" description="New downloads are filed into Inbox automatically. Nothing is waiting here." />
      ) : (
        <>
          <div className="library-plan-summary card">
            <div><span className="stat-label">Models</span><span className="readout">{s?.models}</span></div>
            <div><span className="stat-label">File moves</span><span className="readout">{s?.moves}</span></div>
            <div><span className="stat-label">From ZIPs</span><span className="readout">{s?.extracts}</span></div>
            <div><span className="stat-label">Duplicates → Trash</span><span className="readout">{s?.trash} · {formatBytes(s?.trashBytes ?? 0)}</span></div>
            <div><span className="stat-label">Planned</span><span className="readout">{relativeDate(plan.createdAt)}</span></div>
          </div>

          <div className="library-plan-bar">
            <span role="status">{working ?? `${selected.size} of ${plan.models.length} selected`}</span>
            <Button variant="ghost" onClick={() => toggle(allIds, selected.size < allIds.length)}>
              {selected.size < allIds.length ? 'Select all' : 'Select none'}
            </Button>
            <Button variant="primary" disabled={!helper.available || !selected.size || Boolean(working)} onClick={() => void apply()}>
              <FolderInput size={16} aria-hidden="true" /> Organize selected
            </Button>
          </div>

          {groups.map(([category, models]) => {
            const ids = models.map(m => m.id);
            const allOn = ids.every(id => selected.has(id));
            return (
              <section key={category} className="library-plan-group">
                <SectionRail
                  title={<span>{category === 'Duplicates only' ? <Trash2 size={16} aria-hidden="true" /> : <FolderInput size={16} aria-hidden="true" />} {categoryLabel(category)}</span>}
                  count={models.length}
                  actions={<Button variant="ghost" onClick={() => toggle(ids, !allOn)}>{allOn ? 'Clear' : 'Select group'}</Button>}
                />
                <ul className="library-plan-list">
                  {models.map(m => (
                    <li key={m.id} className="card">
                      <label className="library-plan-row">
                        <input type="checkbox" checked={selected.has(m.id)} onChange={event => toggle([m.id], event.target.checked)} />
                        <span className="library-plan-thumb">
                          {m.thumb ? <img src={libraryThumbUrl(m.thumb)} alt="" loading="lazy" /> : <Box size={22} aria-hidden="true" />}
                        </span>
                        <span className="library-plan-main">
                          <strong>{m.title}</strong>
                          <small>
                            {m.origin === 'intake' ? 'From ' : 'In '}{m.sourceLabel}
                            {m.dest && <> <ArrowRight size={12} aria-hidden="true" /> {m.dest.replace(/^_(Inbox|Archive)\//, '$1/')}</>}
                            {m.suggestedCategory && m.suggestedCategory !== m.category && m.category === '_Inbox' && ` · looks like ${m.suggestedCategory}`}
                          </small>
                        </span>
                        <span className="library-plan-counts">
                          <span className={`pill ${LIBRARY_STATUS_TONE[m.status]}`}>{LIBRARY_STATUS_LABELS[m.status]}</span>
                          {m.moveCount + m.extractCount > 0 && <span className="pill">{m.moveCount + m.extractCount} files</span>}
                          {m.trashCount > 0 && <span className="pill flag-amber">{m.trashCount} duplicate{m.trashCount === 1 ? '' : 's'}</span>}
                        </span>
                      </label>
                      <details className="library-plan-details">
                        <summary>Details</summary>
                        <ul>
                          {m.moves.map(mv => <li key={mv.from}><span>{mv.from}</span> <ArrowRight size={12} aria-hidden="true" /> <span>{mv.to}</span></li>)}
                          {m.moveCount > m.moves.length && <li>…and {m.moveCount - m.moves.length} more</li>}
                          {m.trash.map(t => <li key={t.path} className="library-plan-trash"><Trash2 size={12} aria-hidden="true" /> {t.path} — {t.reason}</li>)}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {batches.length > 0 && (
        <section className="library-section">
          <SectionRail title={<span><History size={16} aria-hidden="true" /> History</span>} count={batches.length} />
          <ul className="library-history">
            {batches.slice(0, 20).map(b => (
              <li key={b.batch}>
                <span>
                  <strong>{b.kind === 'intake' ? 'Filed downloads' : b.kind === 'migrate' ? 'Organized' : b.kind === 'file' ? 'Moved a model' : b.kind === 'edit' ? 'Saved edits' : b.kind === 'trash' ? 'Trashed a file' : b.kind === 'category' ? 'Changed a category' : 'Change'}</strong>
                  <small>{relativeDate(b.at)} · {b.ops} operations{b.undone ? ' · undone' : ''}</small>
                </span>
                {helper.available && !b.undone && b.kind !== 'edit' && (
                  <Button variant="ghost" disabled={Boolean(working)} onClick={() => void undo(b.batch)}>
                    <Undo2 size={16} aria-hidden="true" /> Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageFrame>
  );
}

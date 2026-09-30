import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Box, Check, Link2, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  confirmLibraryMatch, getLibraryOverview, libraryThumbUrl, listLibraryDuplicates, listLibraryMatches,
  listLibraryModels, rejectLibraryMatch, syncLibraryPrintHistory,
} from '../services/api';
import type { LibraryDuplicateGroup, LibraryModel, LibraryPrint } from '../types/project';
import { categoryLabel, formatBytes, formatDuration, formatGrams, relativeDate } from '../lib/library';
import { Button, PageFrame, PageHeader, SegmentedControl, StatePanel } from '../components/ui';

type Tab = 'matches' | 'duplicates';

export default function LibraryReview() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'duplicates' ? 'duplicates' : 'matches';

  return (
    <PageFrame className="library-review">
      <Link to="/" className="library-back"><ArrowLeft size={16} aria-hidden="true" /> Library</Link>
      <PageHeader
        title="Review"
        description="Confirm which model each Bambu print was, and look at models that share the same geometry."
      />
      <div className="dashboard-switcher">
        <SegmentedControl
          label="Review"
          value={tab}
          options={[{ value: 'matches', label: 'Print matches' }, { value: 'duplicates', label: 'Same geometry' }] as const}
          onChange={next => setParams(next === 'matches' ? {} : { tab: next })}
        />
      </div>
      {tab === 'matches' ? <Matches /> : <Duplicates />}
    </PageFrame>
  );
}

function Matches() {
  const [items, setItems] = useState<LibraryPrint[] | null>(null);
  const [canSync, setCanSync] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [matches, overview] = await Promise.all([listLibraryMatches(), getLibraryOverview()]);
    setItems(matches);
    setCanSync(overview.printHistory.available);
  }, []);

  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncLibraryPrintHistory();
      toast.success(`${r.imported} prints checked`, { description: `${r.auto} linked automatically · ${r.suggested} to review` });
      await load();
    } catch (err) {
      toast.error('Print history sync failed', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSyncing(false);
    }
  };

  const resolve = async (print: LibraryPrint, action: 'confirm' | 'reject', modelId?: string) => {
    try {
      if (action === 'confirm') await confirmLibraryMatch(print.id, modelId);
      else await rejectLibraryMatch(print.id);
      setItems(current => current?.filter(p => p.id !== print.id) ?? null);
    } catch (err) {
      toast.error('Could not save', { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <section>
      {canSync && (
        <div className="library-plan-bar">
          <span>Prints come from ShapePilot's Bambu Cloud history.</span>
          <Button onClick={() => void sync()} disabled={syncing}>
            <RefreshCw size={16} aria-hidden="true" /> {syncing ? 'Syncing…' : 'Sync print history'}
          </Button>
        </div>
      )}
      {items === null ? (
        <p className="page-sub" role="status">Loading…</p>
      ) : items.length === 0 ? (
        <StatePanel title="Nothing to review" description="Prints whose names match a model exactly are linked automatically. Close calls show up here." />
      ) : (
        <ul className="library-matches">
          {items.map(print => <MatchRow key={print.id} print={print} onResolve={resolve} />)}
        </ul>
      )}
    </section>
  );
}

function MatchRow({ print, onResolve }: { print: LibraryPrint; onResolve: (p: LibraryPrint, a: 'confirm' | 'reject', modelId?: string) => void }) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<LibraryModel[]>([]);
  const [choice, setChoice] = useState<string>(print.model_id ?? '');

  useEffect(() => {
    if (search.trim().length < 2) return;
    const t = setTimeout(() => {
      listLibraryModels({ q: search.trim(), limit: 8 }).then(r => setOptions(r.items)).catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <li className="library-match card">
      <div className="library-match-job">
        <span className={`pill ${print.result === 'completed' ? 'flag-green' : 'flag-red'}`}>{print.result === 'completed' ? 'Printed' : 'Failed'}</span>
        <strong>{print.title ?? 'Untitled job'}</strong>
        <small>{relativeDate(print.started_at)} · {formatDuration(print.seconds)} · {formatGrams(print.grams)}</small>
      </div>
      <div className="library-match-model">
        {print.model_id && print.match_state === 'suggested' ? (
          <Link to={`/library/${print.model_id}`} className="library-match-candidate">
            {print.model_thumb ? <img src={libraryThumbUrl(print.model_thumb)} alt="" /> : <Box size={20} aria-hidden="true" />}
            <span>
              <strong>{print.model_title}</strong>
              <small>{Math.round((print.match_score ?? 0) * 100)}% name match</small>
            </span>
          </Link>
        ) : (
          <div className="library-match-pick">
            <input value={search} placeholder="Find the model…" aria-label="Find the model" onChange={event => setSearch(event.target.value)} />
            {options.length > 0 && (
              <select value={choice} aria-label="Model" onChange={event => setChoice(event.target.value)}>
                <option value="">Choose…</option>
                {options.map(m => <option key={m.id} value={m.id}>{m.title} ({categoryLabel(m.category)})</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      <div className="library-match-actions">
        <Button variant="primary" disabled={!choice && !print.model_id} onClick={() => onResolve(print, 'confirm', choice || undefined)}>
          <Check size={16} aria-hidden="true" /> {print.match_state === 'suggested' ? 'Yes, that one' : 'Link'}
        </Button>
        <Button variant="ghost" onClick={() => onResolve(print, 'reject')}>
          <X size={16} aria-hidden="true" /> Not in library
        </Button>
      </div>
    </li>
  );
}

function Duplicates() {
  const [groups, setGroups] = useState<LibraryDuplicateGroup[] | null>(null);

  useEffect(() => {
    listLibraryDuplicates().then(setGroups).catch(() => setGroups([]));
  }, []);

  if (groups === null) return <p className="page-sub" role="status">Loading…</p>;
  if (!groups.length) {
    return <StatePanel title="No shared geometry" description="Exact copies are cleaned up during organizing. Different files with identical meshes would show up here." />;
  }
  return (
    <ul className="library-dupes">
      {groups.map(group => (
        <li key={group.geom_hash} className="card">
          <p className="library-hint"><Link2 size={14} aria-hidden="true" /> Same mesh in {new Set(group.files.map(f => f.model_id)).size} models</p>
          <div className="library-dupe-row">
            {group.files.map(file => (
              <Link key={file.id} to={`/library/${file.model_id}`} className="library-dupe">
                {file.thumb_hash || file.model_thumb
                  ? <img src={libraryThumbUrl((file.thumb_hash || file.model_thumb)!)} alt="" loading="lazy" />
                  : <Sparkles size={20} aria-hidden="true" />}
                <strong>{file.title}</strong>
                <small>{categoryLabel(file.category)} · {file.filename} · {formatBytes(file.size)}</small>
              </Link>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

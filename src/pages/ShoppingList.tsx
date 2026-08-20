import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Printer, Search, ShoppingCart } from 'lucide-react';
import { getShoppingList, togglePurchased } from '../services/api';
import type { ShoppingListItem } from '../types/project';
import { groupShoppingItems, shoppingSummary } from '../lib/coreWorkflows';
import { Button, PageFrame, PageHeader, SectionRail, StatePanel } from '../components/ui';
import { ProjectCardSkeleton } from '../components/Skeleton';

export default function ShoppingList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPurchased, setShowPurchased] = useState(false);
  const [search, setSearch] = useState('');
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getShoppingList()
      .then(setItems)
      .catch(error => {
        console.error('Shopping list load failed', error);
        setLoadError('Workshop could not load the shopping list. Check the connection and try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (id: number, currentPurchased: boolean) => {
    const next = !currentPurchased;
    setUpdatingIds(current => new Set(current).add(id));
    setItems(prev => prev.map(i => i.id === id ? { ...i, purchased: next } : i));
    try {
      await togglePurchased(id, next);
    } catch (error) {
      console.error('Shopping item update failed', error);
      setItems(prev => prev.map(i => i.id === id ? { ...i, purchased: currentPurchased } : i));
      setLoadError('That item could not be updated. Try again.');
    } finally {
      setUpdatingIds(current => {
        const nextIds = new Set(current);
        nextIds.delete(id);
        return nextIds;
      });
    }
  };

  const grouped = useMemo(
    () => groupShoppingItems(items, search, showPurchased),
    [items, search, showPurchased],
  );
  const summary = useMemo(() => shoppingSummary(items), [items]);
  const visibleOutstanding = grouped.flatMap(group => group.items).filter(item => !item.purchased);

  const markVisiblePurchased = async () => {
    if (visibleOutstanding.length === 0) return;
    const ids = visibleOutstanding.map(item => item.id);
    setUpdatingIds(current => new Set([...current, ...ids]));
    setItems(current => current.map(item => ids.includes(item.id) ? { ...item, purchased: true } : item));
    const failed = new Set<number>();
    await Promise.all(visibleOutstanding.map(async item => {
      try {
        await togglePurchased(item.id, true);
      } catch (error) {
        console.error('Shopping bulk update failed', error);
        failed.add(item.id);
      }
    }));
    if (failed.size > 0) {
      setItems(current => current.map(item => failed.has(item.id) ? { ...item, purchased: false } : item));
      setLoadError(`${failed.size} item${failed.size === 1 ? '' : 's'} could not be updated. Try again.`);
    }
    setUpdatingIds(current => {
      const nextIds = new Set(current);
      ids.forEach(id => nextIds.delete(id));
      return nextIds;
    });
  };

  return (
    <PageFrame maxWidth={920} className="shopping-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" /> Back
      </Button>
      <PageHeader
        title="Shopping List"
        description={summary.outstandingCount === 0
          ? 'Everything in the current acquisition plan is purchased.'
          : `${summary.outstandingCount} item${summary.outstandingCount === 1 ? '' : 's'} outstanding · ${formatMoney(summary.outstandingCost)} estimated`}
        actions={(
          <>
            <Button variant="ghost" onClick={() => printShoppingList(grouped, items)}>
              <Printer size={16} aria-hidden="true" /> Print
            </Button>
            <Button
              variant="primary"
              onClick={() => void markVisiblePurchased()}
              disabled={visibleOutstanding.length === 0 || updatingIds.size > 0}
            >
              <Check size={16} aria-hidden="true" /> Mark visible purchased
            </Button>
          </>
        )}
      />

      <section className="shopping-overview" aria-label="Shopping progress">
        <div>
          <strong>{summary.outstandingCount}</strong>
          <span>To acquire</span>
        </div>
        <div>
          <strong>{summary.purchasedCount}</strong>
          <span>Purchased</span>
        </div>
        <div>
          <strong>{formatMoney(summary.outstandingCost)}</strong>
          <span>Estimated remaining</span>
        </div>
      </section>

      <div className="shopping-tools">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search shopping items or projects</span>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search items or project names"
          />
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={showPurchased}
            onChange={event => setShowPurchased(event.target.checked)}
          />
          <span>Show purchased</span>
        </label>
      </div>

      {loadError && (
        <StatePanel
          title="Shopping list needs attention"
          description={loadError}
          tone="danger"
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      )}

      {loading ? (
        <div className="shopping-skeletons" aria-label="Loading shopping list">
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
        </div>
      ) : grouped.length === 0 ? (
        <StatePanel
          title={items.length === 0
            ? 'No materials to acquire yet'
            : search
              ? 'No matching shopping items'
              : 'Everything is purchased'}
          description={items.length === 0
            ? 'Add materials to a project and they will appear here with their project context.'
            : search
              ? 'Change the search or include purchased items to bring more materials into view.'
              : 'Turn on “Show purchased” to review the completed list.'}
        />
      ) : (
        <div className="shopping-groups">
          {grouped.map(group => (
            <section className="shopping-group" key={group.id} aria-labelledby={`shopping-project-${group.id}`}>
              <SectionRail
                title={(
                  <Link id={`shopping-project-${group.id}`} to={`/projects/${group.id}`}>
                    {group.title}
                  </Link>
                )}
                count={`${group.outstandingCount} left · ${formatMoney(group.outstandingCost)}`}
              />
              <div className="board shopping-items">
                {group.items.map(item => (
                  <label key={item.id} className={item.purchased ? 'shopping-row is-purchased' : 'shopping-row'}>
                    <input
                      type="checkbox"
                      checked={item.purchased}
                      disabled={updatingIds.has(item.id)}
                      onChange={() => void handleToggle(item.id, item.purchased)}
                    />
                    <span className="shopping-row-copy">
                      <strong>{item.name}</strong>
                      {item.qty_label && <small>{item.qty_label}</small>}
                    </span>
                    {item.cost > 0 && <span className="shopping-row-cost">{formatMoney(item.cost)}</span>}
                    <span className="shopping-row-state">
                      {updatingIds.has(item.id) ? 'Saving…' : item.purchased ? 'Purchased' : 'Needed'}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="board-plate"><ShoppingCart size={14} aria-hidden="true" /> Grouped by project provenance</p>
    </PageFrame>
  );
}

function formatMoney(n: number) { return `$${(n || 0).toFixed(2)}`; }

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function printShoppingList(
  grouped: { id: number; title: string; items: ShoppingListItem[] }[],
  allItems: ShoppingListItem[],
) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const unpurchased = allItems.filter(i => !i.purchased);
  const total = unpurchased.reduce((s, i) => s + (i.cost || 0), 0);

  const sections = grouped.map(({ title, items }) => `
    <div class="project">
      <div class="project-title">${escHtml(title)}</div>
      <table>
        <tbody>
          ${items.map(item => `
            <tr>
              <td style="padding: 8px 0 8px 8px; width: 18px;">
                <span style="display:inline-block;width:13px;height:13px;border:1.5px solid #58716B;border-radius:10px;vertical-align:middle;background:${item.purchased ? '#2F7657' : '#FAFCFB'}"></span>
              </td>
              <td style="padding: 8px 6px; ${item.purchased ? 'text-decoration:line-through;color:#58716B;' : ''}">${escHtml(item.name)}${item.qty_label ? `<span style="color:#58716B;font-size:0.76rem;margin-left:6px">${escHtml(item.qty_label)}</span>` : ''}</td>
              <td style="padding: 8px 0; text-align: right; ${item.purchased ? 'color:#58716B;text-decoration:line-through;' : ''}">${item.cost > 0 ? formatMoney(item.cost) : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shopping List</title>
<style>
  @page { size: letter portrait; margin: 0.7in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
         font-size: 1rem; color: #15332E; margin: 0; }
  .brand { border-bottom: 2px solid #125447; padding-bottom: 10px; margin-bottom: 4px; }
  .brand::after { content: ''; display: block; height: 1px; background: #C9DAD5; margin-top: 3px; }
  h1 { font-size: 1.22rem; font-weight: 700; margin: 0 0 5px; letter-spacing: -0.025em; }
  .meta { font-size: 0.76rem; color: #58716B; letter-spacing: 0.015em; text-transform: uppercase; }
  .project { margin-bottom: 22px; }
  .project:first-of-type { margin-top: 24px; }
  .project-title { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.015em; text-transform: uppercase;
                   color: #F7FCFA; background: #125447; padding: 6px 10px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td { border-bottom: 1px solid #C9DAD5; }
  .total { font-weight: 700; border-top: 2px solid #125447; padding-top: 9px; margin-top: 6px;
           display: flex; justify-content: space-between; font-size: 1rem;
           text-transform: uppercase; letter-spacing: 0.015em; }
  .plate { margin-top: 26px; font-size: 0.76rem; letter-spacing: 0.015em; color: #58716B; text-transform: uppercase; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="brand">
  <h1>Shopping List</h1>
  <div class="meta">${unpurchased.length} items &middot; ${escHtml(date)}</div>
</div>
${sections}
${total > 0 ? `<div class="total"><span>Estimated Total</span><span>${formatMoney(total)}</span></div>` : ''}
<div class="plate">Measure twice &middot; Cut once</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

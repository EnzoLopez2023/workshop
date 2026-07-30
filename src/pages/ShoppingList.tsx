import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Check, Printer } from 'lucide-react';
import { getShoppingList, togglePurchased } from '../services/api';
import type { ShoppingListItem } from '../types/project';

export default function ShoppingList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPurchased, setShowPurchased] = useState(false);

  const load = () => {
    setLoading(true);
    getShoppingList()
      .then(setItems)
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleToggle = async (id: number, currentPurchased: boolean) => {
    const next = !currentPurchased;
    setItems(prev => prev.map(i => i.id === id ? { ...i, purchased: next } : i));
    try { await togglePurchased(id, next); }
    catch (err) { console.error(err); load(); }
  };

  const grouped = useMemo(() => {
    const visible = showPurchased ? items : items.filter(i => !i.purchased);
    const map = new Map<number, { id: number; title: string; items: ShoppingListItem[] }>();
    for (const item of visible) {
      if (!map.has(item.project_id)) map.set(item.project_id, { id: item.project_id, title: item.project_title, items: [] });
      map.get(item.project_id)!.items.push(item);
    }
    return Array.from(map.values());
  }, [items, showPurchased]);

  const unpurchasedCount = items.filter(i => !i.purchased).length;
  const totalCost = items.filter(i => !i.purchased).reduce((s, i) => s + (i.cost || 0), 0);

  return (
    <div className="page-container" style={{ maxWidth: 780 }}>
      <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ gap: 6, marginBottom: 24 }}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="page-head">
        <div className="page-head-main">
          <h1 className="page-title">
            <ShoppingCart size={20} strokeWidth={2.2} style={{ color: 'var(--color-amber)', display: 'inline-block', verticalAlign: '-2px', marginRight: 10 }} />
            Shopping List
          </h1>
          <p className="page-sub">
            {unpurchasedCount === 0
              ? 'Everything on the manifest is bought.'
              : `${unpurchasedCount} item${unpurchasedCount !== 1 ? 's' : ''} outstanding · est. ${formatMoney(totalCost)}`}
          </p>
        </div>
        <div className="page-head-actions">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--color-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showPurchased} onChange={e => setShowPurchased(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--color-steel)' }} />
            Show purchased
          </label>
          <button className="btn btn-ghost" onClick={() => printShoppingList(grouped, items)} style={{ fontSize: '0.82rem', gap: 6 }}>
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
          {items.length === 0
            ? 'No materials across your projects yet.'
            : 'Everything has been purchased.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {grouped.map(({ id, title, items: projectItems }) => (
            <div className="board" key={id}>
              <div className="rail">
                {title}
                <span className="rail-count">{String(projectItems.filter(x => !x.purchased).length).padStart(2, '0')}</span>
              </div>
              <div>
                {projectItems.map((item, i) => (
                  <label
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 18px',
                      borderTop: i > 0 ? '1px solid var(--color-line)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.purchased}
                      onChange={() => handleToggle(item.id, item.purchased)}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontWeight: 500, fontSize: '0.92rem',
                        textDecoration: item.purchased ? 'line-through' : 'none',
                        color: item.purchased ? 'var(--color-muted)' : 'var(--color-ink)',
                      }}>
                        {item.name}
                      </div>
                      {item.qty_label && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--color-muted)', marginTop: 2 }}>{item.qty_label}</div>
                      )}
                    </div>
                    {item.cost > 0 && (
                      <div className="readout" style={{
                        fontSize: '0.88rem',
                        color: item.purchased ? 'var(--color-muted)' : 'var(--color-ink)',
                        textDecoration: item.purchased ? 'line-through' : 'none',
                        flexShrink: 0,
                      }}>
                        {formatMoney(item.cost)}
                      </div>
                    )}
                    {item.purchased && <Check size={14} strokeWidth={3} style={{ color: 'var(--color-green)', flexShrink: 0 }} />}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
                <span style="display:inline-block;width:13px;height:13px;border:1.5px solid #59686A;border-radius:1px;vertical-align:middle;background:${item.purchased ? '#2E7148' : '#fff'}"></span>
              </td>
              <td style="padding: 8px 6px; ${item.purchased ? 'text-decoration:line-through;color:#8FA09E;' : ''}">${escHtml(item.name)}${item.qty_label ? `<span style="color:#59686A;font-size:9.5px;margin-left:6px">${escHtml(item.qty_label)}</span>` : ''}</td>
              <td style="padding: 8px 0; text-align: right; ${item.purchased ? 'color:#8FA09E;text-decoration:line-through;' : ''}">${item.cost > 0 ? formatMoney(item.cost) : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shopping List</title>
<style>
  @page { size: letter portrait; margin: 0.7in; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace;
         font-size: 10.5px; color: #14181A; margin: 0; }
  .brand { border-bottom: 2px solid #232A2F; padding-bottom: 10px; margin-bottom: 4px; }
  .brand::after { content: ''; display: block; height: 1px; background: #C0CAC6; margin-top: 3px; }
  h1 { font-size: 19px; font-weight: 700; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 0.01em; }
  .meta { font-size: 9px; color: #59686A; letter-spacing: 0.1em; text-transform: uppercase; }
  .project { margin-bottom: 22px; }
  .project:first-of-type { margin-top: 24px; }
  .project-title { font-size: 8.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
                   color: #EDF1EE; background: #2B3238; padding: 6px 10px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td { border-bottom: 1px solid #DCE2DE; }
  .total { font-weight: 700; border-top: 2px solid #232A2F; padding-top: 9px; margin-top: 6px;
           display: flex; justify-content: space-between; font-size: 12px;
           text-transform: uppercase; letter-spacing: 0.08em; }
  .plate { margin-top: 26px; font-size: 8px; letter-spacing: 0.24em; color: #59686A; text-transform: uppercase; }
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

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 12 }}>
        <button onClick={() => navigate(-1)} className="btn btn-ghost" style={{ gap: 6 }}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--color-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showPurchased} onChange={e => setShowPurchased(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--color-ink-soft)' }} />
            Show purchased
          </label>
          <button
            className="btn btn-ghost"
            onClick={() => printShoppingList(grouped, items)}
            style={{ fontSize: '0.82rem', gap: 6 }}
          >
            <Printer size={14} />
            Print
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <ShoppingCart size={22} style={{ color: 'var(--color-rust)' }} />
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '2rem', fontWeight: 700 }}>Shopping List</h1>
      </div>
      <p style={{ margin: '0 0 36px', color: 'var(--color-muted)', fontSize: '0.9rem' }}>
        {unpurchasedCount === 0
          ? 'All items purchased.'
          : `${unpurchasedCount} item${unpurchasedCount !== 1 ? 's' : ''} needed · est. ${formatMoney(totalCost)}`}
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 48 }}>Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>
          {items.length === 0
            ? 'No materials across your projects yet.'
            : 'Everything has been purchased.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {grouped.map(({ id, title, items: projectItems }) => (
            <div key={id}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
                {title}
              </div>
              <div className="card">
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
                      style={{ width: 16, height: 16, accentColor: 'var(--color-ink-soft)', cursor: 'pointer', flexShrink: 0 }}
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
                      <div style={{
                        fontVariantNumeric: 'tabular-nums', fontSize: '0.88rem',
                        color: item.purchased ? 'var(--color-muted)' : 'var(--color-ink)',
                        textDecoration: item.purchased ? 'line-through' : 'none',
                        flexShrink: 0,
                      }}>
                        {formatMoney(item.cost)}
                      </div>
                    )}
                    {item.purchased && <Check size={14} style={{ color: 'var(--color-rust)', flexShrink: 0 }} />}
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
                <span style="display:inline-block;width:14px;height:14px;border:1.5px solid #8B7A6B;border-radius:3px;vertical-align:middle;background:${item.purchased ? '#A0522D' : 'white'}"></span>
              </td>
              <td style="padding: 8px 6px; ${item.purchased ? 'text-decoration:line-through;color:#8B7A6B;' : ''}">${escHtml(item.name)}${item.qty_label ? `<span style="color:#8B7A6B;font-size:10px;margin-left:6px">${escHtml(item.qty_label)}</span>` : ''}</td>
              <td style="padding: 8px 0; text-align: right; ${item.purchased ? 'color:#8B7A6B;text-decoration:line-through;' : ''}">${item.cost > 0 ? formatMoney(item.cost) : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shopping List</title>
<style>
  @page { size: letter portrait; margin: 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, serif; font-size: 11px; color: #1C0F07; margin: 0; }
  .brand { border-left: 4px solid #A0522D; padding-left: 16px; margin-bottom: 28px; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .meta { font-size: 10px; color: #8B7A6B; font-family: Arial, sans-serif; }
  .project { margin-bottom: 24px; }
  .project-title { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #8B7A6B; border-bottom: 1px solid #EDE8E3; padding-bottom: 6px; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; }
  .total { font-weight: 700; border-top: 2px solid #1C0F07; padding-top: 8px; margin-top: 4px; display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 12px; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="brand">
  <h1>Shopping List</h1>
  <div class="meta">${unpurchased.length} items · ${escHtml(date)}</div>
</div>
${sections}
${total > 0 ? `<div class="total"><span>Estimated Total</span><span>${formatMoney(total)}</span></div>` : ''}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

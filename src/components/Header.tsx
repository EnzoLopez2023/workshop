import { Plus, LogOut, Ruler, ShoppingCart, BookOpen, Moon, Sun, Settings, Search, PlayCircle } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Tooltip } from './Tooltip';
import { isDemoMode, exitDemoMode } from '../demo/demoMode';

function ShaperIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinejoin="round" strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 2L14.5 13.5H1.5L8 2Z" />
    </svg>
  );
}

export default function Header() {
  const { instance, accounts } = useMsal();
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/';
  const at = (prefix: string) => location.pathname.startsWith(prefix);
  const { resolvedTheme, setTheme } = useTheme();

  const account = accounts[0] ?? null;
  const displayName = account?.name ?? account?.username ?? '';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join('') || '?';

  const demo = isDemoMode();

  const handleSignOut = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  const handleExitDemo = () => {
    exitDemoMode();
    window.location.assign('/');
  };

  return (
    <header className="site-header">

      {/* Logo */}
      <div className="header-logo-wrap">
        <button
          onClick={() => navigate('/')}
          style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}
        >
          <img
            src="/favicon.svg"
            alt="The Workshop"
            width={34}
            height={34}
            style={{ borderRadius: 'var(--r-flap)', flexShrink: 0, display: 'block' }}
          />
          <div style={{ lineHeight: 1.15, textAlign: 'left', minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-board)', fontStretch: '80%', fontWeight: 700,
              fontSize: '0.9rem', letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--color-on-steel)', whiteSpace: 'nowrap',
            }}>
              The Workshop
            </div>
            <div className="header-logo-subtitle" style={{
              fontFamily: 'var(--font-board)', fontStretch: '78%', fontSize: '0.56rem',
              letterSpacing: '0.2em', color: 'var(--color-amber-fill)', fontWeight: 600,
            }}>
              PROJECT COMPANION
            </div>
          </div>
        </button>
      </div>

      {/* Nav — moves below logo+actions on mobile */}
      <nav className="header-nav-group">
        <button
          className={`btn btn-ghost${at('/conversions') ? ' is-current' : ''}`}
          onClick={() => navigate('/conversions')}
          style={{ gap: 6 }}
        >
          <Ruler size={14} strokeWidth={2} />
          <span className="header-nav-label">Conversions</span>
        </button>
        <button
          className={`btn btn-ghost${at('/shopping-list') ? ' is-current' : ''}`}
          onClick={() => navigate('/shopping-list')}
          style={{ gap: 6 }}
        >
          <ShoppingCart size={14} strokeWidth={2} />
          <span className="header-nav-label">Shopping List</span>
        </button>
        {isDashboard && (
          <button className="btn btn-ghost" onClick={() => navigate('/shaper/new')} style={{ gap: 6 }}>
            <ShaperIcon size={15} />
            <span className="header-nav-label">Shaper Hub</span>
          </button>
        )}
      </nav>

      {/* Actions — stays on same line as logo on mobile */}
      <div className="header-actions">
        {isDashboard && (
          <button className="btn btn-primary" onClick={() => navigate('/projects/new')}>
            <Plus size={16} strokeWidth={2.4} />
            <span className="header-new-label">New Project</span>
          </button>
        )}
        <Tooltip content="Search & navigate (⌘K)">
          <button
            className="btn btn-ghost"
            onClick={() => window.dispatchEvent(new CustomEvent('workshop:palette'))}
            style={{ gap: 6, padding: '8px 10px' }}
          >
            <Search size={15} strokeWidth={2} />
          </button>
        </Tooltip>
        <Tooltip content="Notebook">
          <button
            className={`btn btn-ghost${at('/notebook') ? ' is-current' : ''}`}
            onClick={() => navigate('/notebook')}
            style={{ gap: 6 }}
          >
            <BookOpen size={15} strokeWidth={2} />
          </button>
        </Tooltip>
        <Tooltip content={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <button
            className="btn btn-ghost"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            style={{ gap: 6, padding: '8px 10px' }}
          >
            {resolvedTheme === 'dark'
              ? <Sun size={15} strokeWidth={2} />
              : <Moon size={15} strokeWidth={2} />}
          </button>
        </Tooltip>
        <Tooltip content="Settings">
          <button
            className={`btn btn-ghost${at('/settings') ? ' is-current' : ''}`}
            onClick={() => navigate('/settings')}
            style={{ gap: 6, padding: '8px 10px' }}
          >
            <Settings size={15} strokeWidth={2} />
          </button>
        </Tooltip>
        {demo ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="demo-flag"
              title="You're exploring sample data — changes aren't saved"
            >
              <PlayCircle size={12} strokeWidth={2.2} /> DEMO · READ ONLY
            </span>
            <button className="btn btn-ghost" onClick={handleExitDemo} style={{ gap: 6 }}>
              <LogOut size={15} strokeWidth={2} />
              <span className="header-nav-label">Exit demo</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="header-avatar" title={displayName}>{initials}</div>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="header-icon-btn"
            >
              <LogOut size={16} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

    </header>
  );
}

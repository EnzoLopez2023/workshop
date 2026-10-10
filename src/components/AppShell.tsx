import {
  BookOpen,
  Hammer,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Ruler,
  Rows3,
  Archive,
  Search,
  Settings,
  ShoppingCart,
  Sun,
} from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { exitDemoMode, isDemoMode } from '../demo/demoMode';
import {
  DASHBOARD_PAGE_STORAGE_KEY,
  PRIMARY_NAVIGATION,
  dashboardPageForPath,
  isNavigationItemCurrent,
  type NavigationId,
} from '../navigation';
import { IconButton } from './ui';
import { CreateProjectMenu } from './workflows';
import { TourProvider } from '../tour/Tour';
import { FirstVisitOffer, HelpMenu } from '../tour/TourLaunchers';

const NAV_ICONS: Record<NavigationId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  projects: Hammer,
  shopping: ShoppingCart,
  shelves: Rows3,
  drawers: Archive,
  conversions: Ruler,
  notebook: BookOpen,
  settings: Settings,
};

/** The desktop sidebar can fold to an icon rail; the choice is a per-browser convenience. */
const SIDEBAR_STORAGE_KEY = 'workshop-sidebar';
const readCollapsed = () => {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'; } catch { return false; }
};

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'open'); } catch { /* convenience only */ }
    return next;
  });
  // ⌘\ / Ctrl-\ folds or opens the sidebar, as in most desktop design tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleCollapsed(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const { instance } = useMsal();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const demo = isDemoMode();

  useEffect(() => {
    const dashboardPage = dashboardPageForPath(pathname);
    if (dashboardPage) localStorage.setItem(DASHBOARD_PAGE_STORAGE_KEY, dashboardPage);
  }, [pathname]);

  const account = instance.getActiveAccount();
  const displayName = demo ? 'Demo workspace' : account?.name ?? account?.username ?? 'Workshop account';
  const secondary = demo ? 'Read only' : account?.username ?? 'Signed in';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'W';

  const signOut = () => {
    if (demo) {
      exitDemoMode();
      window.location.assign('/');
      return;
    }
    void instance.logoutRedirect({
      account: account ?? undefined,
      postLogoutRedirectUri: window.location.origin,
    });
  };

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  const openPalette = () => window.dispatchEvent(new CustomEvent('workshop:palette'));

  return (
    <TourProvider>
    <FirstVisitOffer />
    <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'open'}>
      <a className="skip-link" href="#main-content" data-command-background>Skip to content</a>

      <aside className="app-sidebar" aria-label="Workshop navigation" data-command-background>
        <div className="app-brand-row">
          <NavLink to="/" className="app-brand" aria-label="Workshop projects" title={collapsed ? 'Workshop' : undefined}>
            <img className="app-brand-mark" src="/apple-touch-icon.png" alt="" width={44} height={44} />
            <span>
              <strong>Workshop</strong>
              <small>Living plan table</small>
            </span>
          </NavLink>
          <button type="button" className="app-sidebar-toggle" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (⌘\\)`}>
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        </div>

        <nav className="app-sidebar-nav" aria-label="Primary" data-tour="nav">
          {PRIMARY_NAVIGATION.map(item => {
            const Icon = NAV_ICONS[item.id];
            const current = isNavigationItemCurrent(item, pathname);
            return (
              <NavLink
                key={item.id}
                to={item.href}
                className={current ? 'app-nav-link is-current' : 'app-nav-link'}
                aria-current={current ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={19} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-sidebar-actions" aria-label="Create" data-tour="new-project">
          <CreateProjectMenu compact={collapsed} />
        </div>

        <div className="app-sidebar-tools" aria-label="Workspace tools">
          <button type="button" onClick={openPalette} data-tour="search" title={collapsed ? 'Search (⌘K)' : undefined} aria-label={collapsed ? 'Search' : undefined}>
            <Search size={17} aria-hidden="true" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <HelpMenu compact={collapsed} />
          <button type="button" onClick={toggleTheme} title={collapsed ? (resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode') : undefined} aria-label={collapsed ? (resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode') : undefined}>
            {resolvedTheme === 'dark'
              ? <Sun size={17} aria-hidden="true" />
              : <Moon size={17} aria-hidden="true" />}
            <span>{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>

        <div className="app-account">
          <span className="app-account-avatar" aria-hidden="true">{initials}</span>
          <span className="app-account-copy">
            <strong>{displayName}</strong>
            <small>{secondary}</small>
          </span>
          <IconButton label={demo ? 'Exit demo' : 'Sign out'} onClick={signOut}>
            <LogOut size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </aside>

      <header className="app-mobile-header" data-command-background>
        <NavLink to="/" className="app-mobile-brand" aria-label="Workshop projects">
          <img className="app-mobile-brand-mark" src="/apple-touch-icon.png" alt="" width={28} height={28} />
          <strong>Workshop</strong>
        </NavLink>
        <span className="app-mobile-actions">
          <IconButton label="Search and navigate" onClick={openPalette} data-tour="search">
            <Search size={19} aria-hidden="true" />
          </IconButton>
          <HelpMenu compact />
          <span data-tour="new-project"><CreateProjectMenu align="end" compact /></span>
          {!demo && (
            <IconButton label="Sign out" onClick={signOut}>
              <LogOut size={19} aria-hidden="true" />
            </IconButton>
          )}
        </span>
      </header>

      <main id="main-content" className="app-main" tabIndex={-1}>
        {demo && (
          <div className="demo-banner" role="status" data-command-background>
            Demo workspace · read only
            <button type="button" onClick={signOut}>Exit demo</button>
          </div>
        )}
        {children}
      </main>

      <nav className="app-mobile-nav" aria-label="Primary" data-command-background data-tour="nav">
        {PRIMARY_NAVIGATION.map(item => {
          const Icon = NAV_ICONS[item.id];
          const current = isNavigationItemCurrent(item, pathname);
          return (
            <NavLink
              key={item.id}
              to={item.href}
              className={current ? 'app-mobile-nav-link is-current' : 'app-mobile-nav-link'}
              aria-current={current ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={current ? 2.5 : 1.9} aria-hidden="true" />
              <span>{item.compactLabel}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
    </TourProvider>
  );
}

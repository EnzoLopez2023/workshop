import {
  BookOpen,
  Hammer,
  LogOut,
  Moon,
  Ruler,
  Search,
  Settings,
  ShoppingCart,
  Sun,
} from 'lucide-react';
import { useEffect, type ComponentType, type ReactNode } from 'react';
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

const NAV_ICONS: Record<NavigationId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  projects: Hammer,
  shopping: ShoppingCart,
  conversions: Ruler,
  notebook: BookOpen,
  settings: Settings,
};

export default function AppShell({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const demo = isDemoMode();

  useEffect(() => {
    const dashboardPage = dashboardPageForPath(pathname);
    if (dashboardPage) localStorage.setItem(DASHBOARD_PAGE_STORAGE_KEY, dashboardPage);
  }, [pathname]);

  const account = accounts[0] ?? null;
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
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  const openPalette = () => window.dispatchEvent(new CustomEvent('workshop:palette'));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" data-command-background>Skip to content</a>

      <aside className="app-sidebar" aria-label="Workshop navigation" data-command-background>
        <NavLink to="/" className="app-brand" aria-label="Workshop projects">
          <span className="app-brand-mark" aria-hidden="true"><Hammer size={22} strokeWidth={2.4} /></span>
          <span>
            <strong>Workshop</strong>
            <small>Living plan table</small>
          </span>
        </NavLink>

        <nav className="app-sidebar-nav" aria-label="Primary">
          {PRIMARY_NAVIGATION.map(item => {
            const Icon = NAV_ICONS[item.id];
            const current = isNavigationItemCurrent(item, pathname);
            return (
              <NavLink
                key={item.id}
                to={item.href}
                className={current ? 'app-nav-link is-current' : 'app-nav-link'}
                aria-current={current ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="app-sidebar-actions" aria-label="Create">
          <CreateProjectMenu />
        </div>

        <div className="app-sidebar-tools" aria-label="Workspace tools">
          <button type="button" onClick={openPalette}>
            <Search size={17} aria-hidden="true" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <button type="button" onClick={toggleTheme}>
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
          <Hammer size={20} aria-hidden="true" />
          <strong>Workshop</strong>
        </NavLink>
        <span className="app-mobile-actions">
          <IconButton label="Search and navigate" onClick={openPalette}>
            <Search size={19} aria-hidden="true" />
          </IconButton>
          <CreateProjectMenu align="end" compact />
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

      <nav className="app-mobile-nav" aria-label="Primary" data-command-background>
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
  );
}

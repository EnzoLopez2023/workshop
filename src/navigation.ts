export type NavigationId = 'projects' | 'shopping' | 'conversions' | 'notebook' | 'settings';

export interface NavigationItem {
  id: NavigationId;
  label: string;
  compactLabel: string;
  href: string;
  exact?: boolean;
  matchPrefixes: readonly string[];
}

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  {
    id: 'projects',
    label: 'Projects',
    compactLabel: 'Projects',
    href: '/',
    exact: true,
    matchPrefixes: ['/projects', '/shaper'],
  },
  {
    id: 'shopping',
    label: 'Shopping List',
    compactLabel: 'Shop',
    href: '/shopping-list',
    matchPrefixes: ['/shopping-list'],
  },
  {
    id: 'conversions',
    label: 'Conversion Tables',
    compactLabel: 'Tables',
    href: '/conversions',
    matchPrefixes: ['/conversions'],
  },
  {
    id: 'notebook',
    label: 'Notebook',
    compactLabel: 'Notebook',
    href: '/notebook',
    matchPrefixes: ['/notebook'],
  },
  {
    id: 'settings',
    label: 'Settings',
    compactLabel: 'Settings',
    href: '/settings',
    matchPrefixes: ['/settings'],
  },
] as const;

export const APP_ROUTE_PATHS = [
  '/',
  '/projects/new',
  '/projects/:id',
  '/projects/:id/edit',
  '/shaper/new',
  '/shaper/:id',
  '/shaper/:id/edit',
  '/conversions',
  '/shopping-list',
  '/notebook',
  '/notebook/:id',
  '/settings',
] as const;

export function isNavigationItemCurrent(item: NavigationItem, pathname: string): boolean {
  if (item.exact && pathname === item.href) return true;
  return item.matchPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type DashboardPage = 'projects' | 'shaper';

export const DASHBOARD_PAGE_STORAGE_KEY = 'workshop-dashboard-page';

export function readDashboardPage(value: string | null): DashboardPage {
  return value === 'shaper' ? 'shaper' : 'projects';
}

export function dashboardPageForPath(pathname: string): DashboardPage | null {
  if (pathname === '/shaper' || pathname.startsWith('/shaper/')) return 'shaper';
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects';
  return null;
}

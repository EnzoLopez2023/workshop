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
    matchPrefixes: ['/projects', '/shaper', '/bambu'],
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
  '/bambu/new',
  '/bambu/:id',
  '/bambu/:id/edit',
  '/conversions',
  '/shopping-list',
  '/notebook',
  '/notebook/:id',
  '/settings',
] as const;

export function routeTitleForPath(pathname: string): string {
  if (pathname === '/') return 'Projects · Workshop';
  if (pathname === '/projects/new') return 'New Project · Workshop';
  if (/^\/projects\/[^/]+\/edit$/.test(pathname)) return 'Edit Project · Workshop';
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'Project · Workshop';
  if (pathname === '/shaper/new') return 'New Shaper Project · Workshop';
  if (/^\/shaper\/[^/]+\/edit$/.test(pathname)) return 'Edit Shaper Project · Workshop';
  if (/^\/shaper\/[^/]+$/.test(pathname)) return 'Shaper Project · Workshop';
  if (pathname === '/bambu/new') return 'New Bambu Project · Workshop';
  if (/^\/bambu\/[^/]+\/edit$/.test(pathname)) return 'Edit Bambu Project · Workshop';
  if (/^\/bambu\/[^/]+$/.test(pathname)) return 'Bambu Project · Workshop';
  if (pathname === '/conversions') return 'Conversion Tables · Workshop';
  if (pathname === '/shopping-list') return 'Shopping List · Workshop';
  if (pathname === '/notebook') return 'Notebook · Workshop';
  if (pathname === '/notebook/new') return 'New Notebook Page · Workshop';
  if (/^\/notebook\/[^/]+$/.test(pathname)) return 'Notebook Page · Workshop';
  if (pathname === '/settings') return 'Settings · Workshop';
  return 'Workshop · Project Companion';
}

export function isNavigationItemCurrent(item: NavigationItem, pathname: string): boolean {
  if (item.exact && pathname === item.href) return true;
  return item.matchPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type DashboardPage = 'projects' | 'shaper' | 'bambu';

export const DASHBOARD_PAGE_STORAGE_KEY = 'workshop-dashboard-page';

export function readDashboardPage(value: string | null): DashboardPage {
  return value === 'shaper' || value === 'bambu' ? value : 'projects';
}

export function dashboardPageForPath(pathname: string): DashboardPage | null {
  if (pathname === '/shaper' || pathname.startsWith('/shaper/')) return 'shaper';
  if (pathname === '/bambu' || pathname.startsWith('/bambu/')) return 'bambu';
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects';
  return null;
}

export type NavigationId = 'projects' | 'shopping' | 'shelves' | 'drawers' | 'conversions' | 'notebook' | 'settings';

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
    matchPrefixes: ['/projects', '/shaper', '/bambu', '/library'],
  },
  {
    id: 'shopping',
    label: 'Shopping List',
    compactLabel: 'Shop',
    href: '/shopping-list',
    matchPrefixes: ['/shopping-list'],
  },
  {
    id: 'shelves',
    label: 'Shelf Builder',
    compactLabel: 'Shelves',
    href: '/shelves',
    matchPrefixes: ['/shelves'],
  },
  {
    id: 'drawers',
    label: 'Drawer Builder',
    compactLabel: 'Drawers',
    href: '/drawers',
    matchPrefixes: ['/drawers'],
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
  '/library/organize',
  '/library/inbox',
  '/library/review',
  '/library/manage',
  '/library/:id',
  '/conversions',
  '/shelves',
  '/drawers',
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
  if (pathname === '/library/organize') return 'Organize Library · Workshop';
  if (pathname === '/library/inbox') return 'Library Inbox · Workshop';
  if (pathname === '/library/review') return 'Library Review · Workshop';
  if (pathname === '/library/manage') return 'Library Categories & Collections · Workshop';
  if (/^\/library\/[^/]+$/.test(pathname)) return 'Model · Workshop';
  if (pathname === '/conversions') return 'Conversion Tables · Workshop';
  if (pathname === '/shelves') return 'Shelf Builder · Workshop';
  if (pathname === '/drawers') return 'Drawer Builder · Workshop';
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

export type DashboardPage = 'projects' | 'shaper' | 'bambu' | 'library';

export const DASHBOARD_PAGE_STORAGE_KEY = 'workshop-dashboard-page';

export function readDashboardPage(value: string | null): DashboardPage {
  return value === 'shaper' || value === 'bambu' || value === 'library' ? value : 'projects';
}

export function dashboardPageForPath(pathname: string): DashboardPage | null {
  if (pathname === '/shaper' || pathname.startsWith('/shaper/')) return 'shaper';
  if (pathname === '/bambu' || pathname.startsWith('/bambu/')) return 'bambu';
  if (pathname === '/library' || pathname.startsWith('/library/')) return 'library';
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return 'projects';
  return null;
}

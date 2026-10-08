import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsProvider } from './contexts/SettingsContext';
import AppShell from './components/AppShell';
import CommandPalette from './components/CommandPalette';
import ErrorBoundary from './components/ErrorBoundary';
import PageBackground from './components/PageBackground';
import { routeTitleForPath } from './navigation';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const ProjectForm = lazy(() => import('./pages/ProjectForm'));
const ShaperProjectDetail = lazy(() => import('./pages/ShaperProjectDetail'));
const ShaperProjectForm = lazy(() => import('./pages/ShaperProjectForm'));
const BambuProjectDetail = lazy(() => import('./pages/BambuProjectDetail'));
const BambuProjectForm = lazy(() => import('./pages/BambuProjectForm'));
const ConversionTables = lazy(() => import('./pages/ConversionTables'));
const ShoppingList = lazy(() => import('./pages/ShoppingList'));
const ShelfBuilder = lazy(() => import('./pages/ShelfBuilder'));
const DrawerBuilder = lazy(() => import('./pages/DrawerBuilder'));
const NotebookList = lazy(() => import('./pages/NotebookList'));
const NotebookPage = lazy(() => import('./pages/NotebookPage'));
const Settings = lazy(() => import('./pages/Settings'));
const LibraryModelDetail = lazy(() => import('./pages/LibraryModelDetail'));
const LibraryOrganize = lazy(() => import('./pages/LibraryOrganize'));
const LibraryInbox = lazy(() => import('./pages/LibraryInbox'));
const LibraryReview = lazy(() => import('./pages/LibraryReview'));
const LibraryManage = lazy(() => import('./pages/LibraryManage'));

function AppRoutes() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const togglePalette = () => {
      setPaletteOpen(current => {
        if (!current) {
          paletteReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        }
        return !current;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette();
      }
    };
    const onCustom = () => togglePalette();
    window.addEventListener('keydown', onKey);
    window.addEventListener('workshop:palette', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('workshop:palette', onCustom);
    };
  }, []);

  useEffect(() => {
    document.title = routeTitleForPath(location.pathname);
  }, [location.pathname]);

  return (
    <>
      <div key={location.pathname} className="app-route-view" data-command-background>
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/"                  element={<Dashboard />} />
              <Route path="/projects/new"      element={<ProjectForm />} />
              <Route path="/projects/:id"      element={<ProjectDetail />} />
              <Route path="/projects/:id/edit" element={<ProjectForm />} />
              <Route path="/shaper/new"        element={<ShaperProjectForm />} />
              <Route path="/shaper/:id"        element={<ShaperProjectDetail />} />
              <Route path="/shaper/:id/edit"   element={<ShaperProjectForm />} />
              <Route path="/bambu/new"         element={<BambuProjectForm />} />
              <Route path="/bambu/:id"         element={<BambuProjectDetail />} />
              <Route path="/bambu/:id/edit"    element={<BambuProjectForm />} />
              <Route path="/library/organize"  element={<LibraryOrganize />} />
              <Route path="/library/inbox"     element={<LibraryInbox />} />
              <Route path="/library/review"    element={<LibraryReview />} />
              <Route path="/library/manage"    element={<LibraryManage />} />
              <Route path="/library/:id"       element={<LibraryModelDetail />} />
              <Route path="/conversions"       element={<ConversionTables />} />
              <Route path="/shelves"           element={<ShelfBuilder />} />
              <Route path="/built-ins"         element={<DrawerBuilder />} />
              {/* The Built-in Studio was the Drawer Builder; old links (and their ?design= or ?project=) still work. */}
              <Route path="/drawers"           element={<RedirectKeepingQuery to="/built-ins" />} />
              <Route path="/shopping-list"     element={<ShoppingList />} />
              <Route path="/notebook"          element={<NotebookList />} />
              <Route path="/notebook/:id"      element={<NotebookPage />} />
              <Route path="/settings"          element={<Settings />} />
              <Route path="*"                  element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        returnFocusTo={paletteReturnFocusRef.current}
      />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
    <SettingsProvider>
      <div className="workshop-app">
        <PageBackground />
        <AppShell>
          <AppRoutes />
        </AppShell>
        <Toaster
          position="bottom-right"
          closeButton
          visibleToasts={4}
          toastOptions={{
            style: {
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              border: '1px solid var(--color-divider)',
              fontFamily: 'var(--font-ui)',
              borderRadius: 'var(--radius-default)',
              fontSize: '0.88rem',
            },
          }}
        />
      </div>
    </SettingsProvider>
    </ThemeProvider>
  );
}

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="skeleton" aria-hidden="true" />
      <span className="skeleton" aria-hidden="true" />
      <span>Opening workspace…</span>
    </div>
  );
}

/** A permanent move that keeps the query string, so saved ?design= and ?project= links still open. */
function RedirectKeepingQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

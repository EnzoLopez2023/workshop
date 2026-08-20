import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsProvider } from './contexts/SettingsContext';
import AppShell from './components/AppShell';
import CommandPalette from './components/CommandPalette';
import PageBackground from './components/PageBackground';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import ProjectForm from './pages/ProjectForm';
import ShaperProjectDetail from './pages/ShaperProjectDetail';
import ShaperProjectForm from './pages/ShaperProjectForm';
import ConversionTables from './pages/ConversionTables';
import ShoppingList from './pages/ShoppingList';
import NotebookList from './pages/NotebookList';
import NotebookPage from './pages/NotebookPage';
import Settings from './pages/Settings';

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

  return (
    <>
      <div key={location.pathname} className="app-route-view" data-command-background>
        <Routes>
          <Route path="/"                  element={<Dashboard />} />
          <Route path="/projects/new"      element={<ProjectForm />} />
          <Route path="/projects/:id"      element={<ProjectDetail />} />
          <Route path="/projects/:id/edit" element={<ProjectForm />} />
          <Route path="/shaper/new"        element={<ShaperProjectForm />} />
          <Route path="/shaper/:id"        element={<ShaperProjectDetail />} />
          <Route path="/shaper/:id/edit"   element={<ShaperProjectForm />} />
          <Route path="/conversions"       element={<ConversionTables />} />
          <Route path="/shopping-list"     element={<ShoppingList />} />
          <Route path="/notebook"          element={<NotebookList />} />
          <Route path="/notebook/:id"      element={<NotebookPage />} />
          <Route path="/settings"          element={<Settings />} />
          <Route path="*"                  element={<Navigate to="/" replace />} />
        </Routes>
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

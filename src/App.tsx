import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from 'sonner';
import { ThemeProvider } from './contexts/ThemeContext';
import { SettingsProvider } from './contexts/SettingsContext';
import Header from './components/Header';
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

const PAGE_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
};

function AppRoutes() {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    const onCustom = () => setPaletteOpen(v => !v);
    window.addEventListener('keydown', onKey);
    window.addEventListener('workshop:palette', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('workshop:palette', onCustom);
    };
  }, []);

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={location.pathname} {...PAGE_TRANSITION}>
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
        </motion.div>
      </AnimatePresence>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
    <SettingsProvider>
      <div style={{ minHeight: '100vh' }}>
        <PageBackground />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Header />
          <AppRoutes />
        </div>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-paper)',
              color: 'var(--color-ink)',
              border: '1px solid var(--color-line)',
              fontFamily: 'var(--font-sans)',
              borderRadius: '12px',
              fontSize: '0.88rem',
            },
          }}
        />
      </div>
    </SettingsProvider>
    </ThemeProvider>
  );
}

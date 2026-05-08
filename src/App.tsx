import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import ProjectForm from './pages/ProjectForm';
import ShaperProjectDetail from './pages/ShaperProjectDetail';
import ShaperProjectForm from './pages/ShaperProjectForm';
import ConversionTables from './pages/ConversionTables';
import ShoppingList from './pages/ShoppingList';

export default function App() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-cream)' }}>
      <Header />
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
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

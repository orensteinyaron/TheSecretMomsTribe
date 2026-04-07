import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import ContentDetailPage from './pages/ContentDetailPage';
import Placeholder from './pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="pipeline/:id" element={<ContentDetailPage />} />
        <Route path="strategy" element={<Placeholder />} />
        <Route path="research" element={<Placeholder />} />
        <Route path="planner" element={<Placeholder />} />
        <Route path="renders" element={<Placeholder />} />
        <Route path="analytics" element={<Placeholder />} />
        <Route path="activity" element={<Placeholder />} />
        <Route path="system/agents" element={<Placeholder />} />
        <Route path="system/services" element={<Placeholder />} />
        <Route path="system/profiles" element={<Placeholder />} />
        <Route path="system/directives" element={<Placeholder />} />
        <Route path="system/costs" element={<Placeholder />} />
        <Route path="notifications" element={<Placeholder />} />
        <Route path="settings" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}

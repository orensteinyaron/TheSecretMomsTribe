import { Routes, Route } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import ContentDetailPage from './pages/ContentDetailPage';
import Strategy from './pages/Strategy';
import Research from './pages/Research';
import RenderQueue from './pages/RenderQueue';
import Analytics from './pages/Analytics';
import Directives from './pages/Directives';
import Agents from './pages/Agents';
import Services from './pages/Services';
import RenderProfiles from './pages/RenderProfiles';
import Costs from './pages/Costs';
import Activity from './pages/Activity';
import Placeholder from './pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="pipeline/:id" element={<ContentDetailPage />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="research" element={<Research />} />
        <Route path="planner" element={<Placeholder />} />
        <Route path="renders" element={<RenderQueue />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="activity" element={<Activity />} />
        <Route path="system/agents" element={<Agents />} />
        <Route path="system/services" element={<Services />} />
        <Route path="system/profiles" element={<RenderProfiles />} />
        <Route path="system/directives" element={<Directives />} />
        <Route path="system/costs" element={<Costs />} />
        <Route path="notifications" element={<Placeholder />} />
        <Route path="settings" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}

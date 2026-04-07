import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Shell() {
  return (
    <div className="min-h-screen bg-bg-app">
      <Sidebar />
      <main className="ml-56 min-h-screen">
        <div className="px-6 py-6 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

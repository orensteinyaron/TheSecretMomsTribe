import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationBell } from './NotificationBell';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export function Shell() {
  const qc = useQueryClient();

  return (
    <div className="min-h-screen bg-bg-app">
      <Sidebar />
      {/* Top bar */}
      <div className="ml-56 h-12 border-b border-border-subtle bg-bg-sidebar/80 backdrop-blur-sm flex items-center justify-end px-4 gap-2 sticky top-0 z-10">
        <button
          onClick={() => qc.invalidateQueries()}
          className="p-2 rounded-md hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors"
          title="Refresh all data"
        >
          <RefreshCw size={16} />
        </button>
        <NotificationBell />
      </div>
      <main className="ml-56 min-h-[calc(100vh-48px)]">
        <div className="px-6 py-6 max-w-[1400px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

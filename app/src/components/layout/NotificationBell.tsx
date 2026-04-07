import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSystemHealth } from '../../hooks/useSystem';

export function NotificationBell() {
  const navigate = useNavigate();
  const { data: health } = useSystemHealth();

  const count = (health?.pending_tasks ?? 0) + (health?.pending_content ?? 0) + (health?.failed_renders ?? 0) + (health?.agents?.failed ?? 0);

  return (
    <button
      onClick={() => navigate('/notifications')}
      className="relative p-2 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
      title="Notifications"
    >
      <Bell size={20} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-error text-text-inverse text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

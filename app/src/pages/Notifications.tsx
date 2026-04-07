import { Bell, CheckCircle2, XCircle, Film, Target, Bot, AlertTriangle } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';
import { useSystemHealth } from '../hooks/useSystem';
import { useNavigate } from 'react-router-dom';

// Build notifications from system state (no dedicated table yet — derive from live data)
interface Notification {
  id: string;
  type: string;
  urgency: 'low' | 'normal' | 'high';
  title: string;
  description: string;
  route: string;
  icon: typeof Bell;
  iconColor: string;
}

export default function Notifications() {
  const { data: health } = useSystemHealth();
  const navigate = useNavigate();

  // Derive notifications from system health
  const notifications: Notification[] = [];

  if (health) {
    if (health.pending_content > 0) {
      notifications.push({
        id: 'content-review',
        type: 'content_review',
        urgency: 'normal',
        title: `${health.pending_content} content item${health.pending_content > 1 ? 's' : ''} awaiting review`,
        description: 'New drafts from Content Agent need approval.',
        route: '/pipeline',
        icon: CheckCircle2,
        iconColor: 'text-warning',
      });
    }
    if (health.pending_tasks > 0) {
      notifications.push({
        id: 'strategy-tasks',
        type: 'strategy_task',
        urgency: 'normal',
        title: `${health.pending_tasks} strategy task${health.pending_tasks > 1 ? 's' : ''} pending`,
        description: 'Strategist recommendations need approval.',
        route: '/strategy',
        icon: Target,
        iconColor: 'text-info',
      });
    }
    if (health.failed_renders > 0) {
      notifications.push({
        id: 'render-failed',
        type: 'render_failed',
        urgency: 'high',
        title: `${health.failed_renders} render${health.failed_renders > 1 ? 's' : ''} failed`,
        description: 'Check render queue for errors.',
        route: '/renders',
        icon: XCircle,
        iconColor: 'text-error',
      });
    }
    if (health.agents?.failed > 0) {
      notifications.push({
        id: 'agent-failed',
        type: 'agent_failed',
        urgency: 'high',
        title: `${health.agents.failed} agent${health.agents.failed > 1 ? 's' : ''} failed`,
        description: 'Check agent health for errors.',
        route: '/system/agents',
        icon: Bot,
        iconColor: 'text-error',
      });
    }
    if (health.services?.down > 0) {
      notifications.push({
        id: 'service-down',
        type: 'service_down',
        urgency: 'high',
        title: `${health.services.down} service${health.services.down > 1 ? 's' : ''} down`,
        description: 'Some services are disabled or rate limited.',
        route: '/system/services',
        icon: AlertTriangle,
        iconColor: 'text-error',
      });
    }
  }

  // Sort: high urgency first
  const sorted = [...notifications].sort((a, b) => {
    const order = { high: 0, normal: 1, low: 2 };
    return order[a.urgency] - order[b.urgency];
  });

  const URGENCY_BG: Record<string, string> = {
    high: 'border-l-error',
    normal: 'border-l-warning',
    low: 'border-l-text-tertiary',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-6">Notifications</h1>

      {sorted.length === 0 ? (
        <EmptyState icon={<Bell size={24} />} title="All clear" description="No notifications right now. The system is running smoothly." />
      ) : (
        <div className="space-y-3">
          {sorted.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.route)}
              className={`w-full text-left bg-bg-surface border border-border-default border-l-4 ${URGENCY_BG[n.urgency]} rounded-lg p-4 hover:bg-bg-hover transition-colors`}
            >
              <div className="flex items-start gap-3">
                <n.icon size={20} className={n.iconColor} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-text-primary">{n.title}</h3>
                  <p className="text-xs text-text-secondary mt-0.5">{n.description}</p>
                </div>
                <span className={`text-[11px] font-semibold tracking-wide uppercase ${n.urgency === 'high' ? 'text-error' : n.urgency === 'normal' ? 'text-warning' : 'text-text-tertiary'}`}>
                  {n.urgency}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

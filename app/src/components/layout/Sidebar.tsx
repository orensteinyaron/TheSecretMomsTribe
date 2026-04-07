import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Layers, Target, Telescope, CalendarDays, Film,
  TrendingUp, ScrollText, Bot, Plug, Clapperboard, FileText, Wallet, Settings, Bell,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'DAILY',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/pipeline', icon: Layers, label: 'Content Pipeline' },
      { to: '/strategy', icon: Target, label: 'Strategy Tasks' },
      { to: '/research', icon: Telescope, label: 'Research' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/planner', icon: CalendarDays, label: 'Planner' },
      { to: '/renders', icon: Film, label: 'Render Queue' },
      { to: '/analytics', icon: TrendingUp, label: 'Analytics' },
      { to: '/activity', icon: ScrollText, label: 'Activity Log' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/system/agents', icon: Bot, label: 'Agents' },
      { to: '/system/services', icon: Plug, label: 'Services' },
      { to: '/system/profiles', icon: Clapperboard, label: 'Render Profiles' },
      { to: '/system/directives', icon: FileText, label: 'Directives' },
      { to: '/system/costs', icon: Wallet, label: 'Costs' },
    ],
  },
];

const BOTTOM_ITEMS = [
  { to: '/notifications', icon: Bell, label: 'Notifications' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="w-56 h-screen bg-bg-sidebar border-r border-border-subtle flex flex-col fixed left-0 top-0 z-20">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border-subtle">
        <div className="text-base font-bold text-text-primary tracking-tight">
          <span className="text-accent">SMT</span> Command Center
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="text-[10px] font-semibold tracking-widest uppercase text-text-tertiary px-2 mb-1.5">
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-bg-active text-accent font-medium'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom items */}
      <div className="border-t border-border-subtle px-3 py-3">
        {BOTTOM_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-bg-active text-accent font-medium'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}

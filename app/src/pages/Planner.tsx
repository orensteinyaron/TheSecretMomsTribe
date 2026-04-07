import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, AlertTriangle } from 'lucide-react';
import { PlatformIcon } from '../components/shared/PlatformIcon';
import { PillarBadge } from '../components/shared/PillarBadge';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useContentList } from '../hooks/useContent';
import { useNavigate } from 'react-router-dom';
import type { ContentItem } from '../types';

const CADENCE = { tiktok: 3, instagram: 1 };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(offset: number) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - now.getDay() + 1 + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function DayCell({ date, items, platform, target }: { date: Date; items: ContentItem[]; platform: string; target: number }) {
  const navigate = useNavigate();
  const isToday = formatDate(date) === formatDate(new Date());
  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
  const gap = !isPast && items.length < target;

  return (
    <div className={`min-h-[80px] border border-border-subtle rounded-md p-2 ${isToday ? 'border-accent/50 bg-[var(--accent-muted)]' : 'bg-bg-surface'} ${gap ? 'border-warning/40' : ''}`}>
      {items.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          {gap ? (
            <span className="text-xs text-warning flex items-center gap-1"><AlertTriangle size={12} /> Gap</span>
          ) : (
            <span className="text-xs text-text-tertiary">—</span>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 3).map((item) => (
            <button key={item.id} onClick={() => navigate(`/pipeline/${item.id}`)}
              className="w-full text-left bg-bg-elevated rounded px-1.5 py-1 hover:bg-bg-hover transition-colors">
              <p className="text-[11px] text-text-primary truncate">{item.hook}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <PillarBadge pillar={item.content_pillar} />
              </div>
            </button>
          ))}
          {items.length > 3 && <span className="text-[11px] text-text-tertiary">+{items.length - 3} more</span>}
        </div>
      )}
    </div>
  );
}

export default function Planner() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDates = getWeekDates(weekOffset);
  const { data: allContent } = useContentList('all');

  // Group content by date + platform
  const grouped = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const item of allContent || []) {
      const dateKey = (item.scheduled_for || item.created_at).split('T')[0];
      const key = `${dateKey}_${item.platform}`;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }, [allContent]);

  // Gap detection
  const gaps = useMemo(() => {
    let count = 0;
    const today = formatDate(new Date());
    for (const date of weekDates) {
      const ds = formatDate(date);
      if (ds < today) continue;
      for (const [platform, target] of Object.entries(CADENCE)) {
        const items = grouped[`${ds}_${platform}`] || [];
        if (items.length < target) count += target - items.length;
      }
    }
    return count;
  }, [weekDates, grouped]);

  const weekLabel = `${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Planner</h1>
        <div className="flex items-center gap-3">
          {gaps > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-warning bg-[var(--warning-muted)] px-3 py-1 rounded-full">
              <AlertTriangle size={14} /> {gaps} gap{gaps > 1 ? 's' : ''} this week
            </span>
          )}
          <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary"><ChevronLeft size={20} /></button>
          <span className="text-sm font-medium text-text-primary min-w-[200px] text-center">{weekLabel}</span>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary"><ChevronRight size={20} /></button>
          <button onClick={() => setWeekOffset(0)} className="text-xs text-accent hover:text-accent-hover px-2 py-1">Today</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-border-subtle">
          <div className="p-2" />
          {weekDates.map((date, i) => {
            const isToday = formatDate(date) === formatDate(new Date());
            return (
              <div key={i} className={`p-2 text-center border-l border-border-subtle ${isToday ? 'bg-[var(--accent-muted)]' : ''}`}>
                <div className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">{DAYS[i]}</div>
                <div className={`text-sm font-medium ${isToday ? 'text-accent' : 'text-text-primary'}`}>{date.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* TikTok row */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-border-subtle">
          <div className="p-2 flex items-center gap-1.5 bg-bg-app">
            <PlatformIcon platform="tiktok" size={14} />
            <span className="text-xs text-text-secondary">TikTok</span>
            <span className="text-[10px] text-text-tertiary">({CADENCE.tiktok}/d)</span>
          </div>
          {weekDates.map((date, i) => (
            <div key={i} className="border-l border-border-subtle p-1">
              <DayCell date={date} items={grouped[`${formatDate(date)}_tiktok`] || []} platform="tiktok" target={CADENCE.tiktok} />
            </div>
          ))}
        </div>

        {/* Instagram row */}
        <div className="grid grid-cols-[80px_repeat(7,1fr)]">
          <div className="p-2 flex items-center gap-1.5 bg-bg-app">
            <PlatformIcon platform="instagram" size={14} />
            <span className="text-xs text-text-secondary">Instagram</span>
            <span className="text-[10px] text-text-tertiary">({CADENCE.instagram}/d)</span>
          </div>
          {weekDates.map((date, i) => (
            <div key={i} className="border-l border-border-subtle p-1">
              <DayCell date={date} items={grouped[`${formatDate(date)}_instagram`] || []} platform="instagram" target={CADENCE.instagram} />
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-text-tertiary">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-accent/50 bg-[var(--accent-muted)]" /> Today</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-warning/40" /> Gap (below target)</span>
      </div>
    </div>
  );
}

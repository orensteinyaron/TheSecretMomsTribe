import { useState, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, X, CalendarDays, ExternalLink, Film, Image } from 'lucide-react';
import { PillarBadge } from '../components/shared/PillarBadge';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contentApi } from '../api/content';
import type { ContentItem } from '../types';

const DAILY_TARGET = 3; // 3 unique posts/day, cross-posted to both platforms
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

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function getThumbnail(item: ContentItem): string | null {
  if (item.final_asset_url && !item.final_asset_url.endsWith('.mp4')) return item.final_asset_url;
  if (item.image_url) return item.image_url;
  const slideImgs = item.slide_images as any[];
  if (slideImgs?.length && slideImgs[0]?.image_url) return slideImgs[0].image_url;
  return null;
}

function getFormatLabel(item: ContentItem): string {
  if (item.render_profiles && typeof item.render_profiles === 'object' && 'name' in item.render_profiles) {
    return (item.render_profiles as any).name;
  }
  return item.post_format?.replace(/_/g, ' ') || '—';
}

// ── Preview Modal ──

function PreviewModal({ item, onClose, onReschedule, onUnschedule }: {
  item: ContentItem;
  onClose: () => void;
  onReschedule: (date: string) => void;
  onUnschedule: () => void;
}) {
  const navigate = useNavigate();
  const [newDate, setNewDate] = useState(item.scheduled_for?.split('T')[0] || new Date().toISOString().split('T')[0]);
  const isVideo = item.final_asset_url?.endsWith('.mp4');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-surface border border-border-default rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Asset preview */}
        <div className="relative bg-black rounded-t-lg">
          {isVideo && item.final_asset_url ? (
            <video src={item.final_asset_url} controls className="w-full max-h-[300px] object-contain" />
          ) : item.final_asset_url || item.image_url ? (
            <img src={item.final_asset_url || item.image_url!} alt="" className="w-full max-h-[300px] object-contain" />
          ) : (
            <div className="h-[200px] flex items-center justify-center text-text-tertiary">No preview</div>
          )}
          <button onClick={onClose} className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white hover:bg-black/80">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Hook */}
          <h3 className="text-sm font-semibold text-text-primary">{item.hook}</h3>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <PillarBadge pillar={item.content_pillar} />
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary bg-bg-elevated px-2 py-0.5 rounded-full">
              {getFormatLabel(item)}
            </span>
          </div>

          {/* Caption */}
          <p className="text-xs text-text-secondary whitespace-pre-line line-clamp-4">{item.caption}</p>

          {/* Hashtags */}
          {item.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.hashtags.slice(0, 8).map((h, i) => (
                <span key={i} className="text-[11px] text-info bg-bg-elevated px-1.5 py-0.5 rounded">{h}</span>
              ))}
            </div>
          )}

          {/* Schedule */}
          <div className="border-t border-border-subtle pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={14} className="text-text-tertiary" />
              <span className="text-xs text-text-secondary">
                Scheduled: {item.scheduled_for ? new Date(item.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not scheduled'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="bg-bg-input border border-border-default rounded-md px-2 py-1 text-xs text-text-primary"
              />
              <button
                onClick={() => newDate && onReschedule(newDate)}
                disabled={!newDate}
                className="text-xs font-medium text-accent bg-[var(--accent-muted)] px-3 py-1 rounded-md hover:bg-accent/20 disabled:opacity-40"
              >
                {item.scheduled_for ? 'Reschedule' : 'Schedule'}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 border-t border-border-subtle pt-3">
            <button onClick={onUnschedule} className="flex-1 text-xs font-medium text-warning bg-[var(--warning-muted)] px-3 py-2 rounded-md hover:bg-warning/20">
              Remove from schedule
            </button>
            <button onClick={() => navigate(`/pipeline/${item.id}`)} className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-text-primary bg-bg-elevated px-3 py-2 rounded-md hover:bg-bg-hover">
              <ExternalLink size={12} /> Edit content
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Post Card (draggable) ──

function PostCard({ item, onSelect }: { item: ContentItem; onSelect: () => void }) {
  const thumb = getThumbnail(item);
  const isVideo = item.final_asset_url?.endsWith('.mp4');

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
      className="flex gap-2 bg-bg-elevated rounded-md p-1.5 cursor-pointer hover:bg-bg-hover transition-colors group border border-transparent hover:border-border-default"
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded overflow-hidden bg-bg-app shrink-0 flex items-center justify-center">
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : isVideo ? (
          <Film size={14} className="text-text-tertiary" />
        ) : (
          <Image size={14} className="text-text-tertiary" />
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-[11px] text-text-primary truncate leading-tight">{item.hook?.slice(0, 60)}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <PillarBadge pillar={item.content_pillar} />
        </div>
      </div>
    </div>
  );
}

// ── Day Cell (drop target) ──

function DayCell({ date, items, onDrop, onSelect }: {
  date: Date;
  items: ContentItem[];
  onDrop: (id: string) => void;
  onSelect: (item: ContentItem) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isToday = fmtDate(date) === fmtDate(new Date());
  const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
  const gap = !isPast ? Math.max(0, DAILY_TARGET - items.length) : 0;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDrop(id);
      }}
      className={`min-h-[120px] p-1.5 transition-colors ${
        dragOver ? 'bg-accent/10 border-accent/50' : isToday ? 'bg-[var(--accent-muted)]' : ''
      } ${gap > 0 && !isPast ? 'border-l-2 border-l-warning/50' : ''}`}
    >
      <div className="space-y-1.5">
        {items.map((item) => (
          <PostCard key={item.id} item={item} onSelect={() => onSelect(item)} />
        ))}
      </div>
      {items.length === 0 && !isPast && (
        <div className="flex items-center justify-center h-full min-h-[80px]">
          <span className="text-xs text-text-tertiary">{gap > 0 ? `${gap} needed` : '—'}</span>
        </div>
      )}
      {gap > 0 && items.length > 0 && !isPast && (
        <div className="mt-1 text-center">
          <span className="text-[10px] text-warning flex items-center justify-center gap-0.5">
            <AlertTriangle size={10} /> {gap} more
          </span>
        </div>
      )}
    </div>
  );
}

// ── Ready Pool ──

function ReadyPool({ items, onSelect }: { items: ContentItem[]; onSelect: (item: ContentItem) => void }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-6 bg-bg-surface border border-border-default rounded-lg p-4">
      <h2 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-3">
        Ready to Schedule ({items.length})
      </h2>
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => (
          <PostCard key={item.id} item={item} onSelect={() => onSelect(item)} />
        ))}
      </div>
      <p className="text-[10px] text-text-tertiary mt-2">Drag posts to a day cell to schedule them.</p>
    </div>
  );
}

// ── Main ──

export default function Planner() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const weekDates = getWeekDates(weekOffset);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Fetch scheduled + ready content
  const { data: scheduled } = useQuery({ queryKey: ['content', 'scheduled'], queryFn: () => contentApi.scheduled() });
  const { data: ready } = useQuery({ queryKey: ['content', 'ready'], queryFn: () => contentApi.ready() });

  // Group scheduled by date
  const grouped = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const item of scheduled || []) {
      if (!item.scheduled_for) continue;
      const dateKey = item.scheduled_for.split('T')[0];
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(item);
    }
    return map;
  }, [scheduled]);

  // Gap detection
  const gaps = useMemo(() => {
    let count = 0;
    const today = fmtDate(new Date());
    for (const date of weekDates) {
      const ds = fmtDate(date);
      if (ds < today) continue;
      const dayItems = grouped[ds] || [];
      count += Math.max(0, DAILY_TARGET - dayItems.length);
    }
    return count;
  }, [weekDates, grouped]);

  // Drag-and-drop handler
  const handleDrop = async (itemId: string, targetDate: Date) => {
    const dateStr = `${fmtDate(targetDate)}T10:00:00.000Z`;
    await contentApi.update(itemId, { scheduled_for: dateStr } as any);
    qc.invalidateQueries({ queryKey: ['content'] });
  };

  // Unschedule
  const handleUnschedule = async (id: string) => {
    await contentApi.update(id, { scheduled_for: null } as any);
    setSelectedItem(null);
    qc.invalidateQueries({ queryKey: ['content'] });
  };

  // Reschedule
  const handleReschedule = async (id: string, date: string) => {
    await contentApi.update(id, { scheduled_for: `${date}T10:00:00.000Z` } as any);
    setSelectedItem(null);
    qc.invalidateQueries({ queryKey: ['content'] });
  };

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

      {/* Unified calendar grid */}
      <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border-subtle" data-testid="planner-headers">
          {weekDates.map((date, i) => {
            const isToday = fmtDate(date) === fmtDate(new Date());
            const dayItems = grouped[fmtDate(date)] || [];
            return (
              <div key={i} className={`p-2 text-center border-l border-border-subtle first:border-l-0 ${isToday ? 'bg-[var(--accent-muted)]' : ''}`}>
                <div className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">{DAYS[i]}</div>
                <div className={`text-sm font-medium ${isToday ? 'text-accent' : 'text-text-primary'}`}>{date.getDate()}</div>
                <div className="text-[10px] text-text-tertiary mt-0.5">{dayItems.length}/{DAILY_TARGET}</div>
              </div>
            );
          })}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7" data-testid="planner-grid">
          {weekDates.map((date, i) => (
            <div key={i} className="border-l border-border-subtle first:border-l-0">
              <DayCell
                date={date}
                items={grouped[fmtDate(date)] || []}
                onDrop={(id) => handleDrop(id, date)}
                onSelect={setSelectedItem}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-text-tertiary">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-accent/50 bg-[var(--accent-muted)]" /> Today</span>
        <span className="flex items-center gap-1"><span className="w-1 h-3 bg-warning/50 rounded" /> Below target ({DAILY_TARGET}/day)</span>
        <span>Drag posts to reschedule</span>
      </div>

      {/* Ready pool */}
      <ReadyPool items={ready || []} onSelect={setSelectedItem} />

      {/* Preview modal */}
      {selectedItem && (
        <PreviewModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onReschedule={(date) => handleReschedule(selectedItem.id, date)}
          onUnschedule={() => handleUnschedule(selectedItem.id)}
        />
      )}
    </div>
  );
}

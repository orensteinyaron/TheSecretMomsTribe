import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { MetricCard } from '../components/shared/MetricCard';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';

const STAGE_COLORS: Record<string, string> = {
  research: '#818cf8',
  scraping: '#22d3ee',
  content_generation: '#b74780',
  image_generation: '#f472b6',
  image_composition: '#fbbf24',
  video_generation: '#2dd4a0',
  learning: '#60a5fa',
  other: '#6b6b70',
};

function CostByStage({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data)
    .map(([name, value]) => ({ name: name.replace(/_/g, ' '), value: Number(value.toFixed(4)) }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Cost by Pipeline Stage</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c30" />
          <XAxis type="number" tick={{ fill: '#9a9a9f', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#9a9a9f', fontSize: 11 }} width={120} />
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {chartData.map((entry) => {
              const key = entry.name.replace(/ /g, '_');
              return <rect key={entry.name} fill={STAGE_COLORS[key] || '#b74780'} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostByService({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data)
    .map(([name, value]) => ({ name, value: Number(value.toFixed(4)) }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Cost by Service</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c30" />
          <XAxis type="number" tick={{ fill: '#9a9a9f', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#9a9a9f', fontSize: 11 }} width={100} />
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} />
          <Bar dataKey="value" fill="#b74780" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyTrend({ data }: { data: { date: string; total: number }[] }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((d) => ({ date: d.date.slice(5), cost: Number(d.total.toFixed(4)) }));

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5 col-span-2">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Daily Spend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c30" />
          <XAxis dataKey="date" tick={{ fill: '#9a9a9f', fontSize: 11 }} />
          <YAxis tick={{ fill: '#9a9a9f', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} />
          <Line type="monotone" dataKey="cost" stroke="#b74780" strokeWidth={2} dot={{ fill: '#b74780', r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Costs() {
  const [period, setPeriod] = useState('week');
  const { data: summary } = useQuery({ queryKey: ['analytics', 'cost', period], queryFn: () => analyticsApi.costSummary(period) });
  const { data: byAgent } = useQuery({ queryKey: ['analytics', 'cost_by_agent'], queryFn: () => analyticsApi.costByAgent() });
  const { data: byService } = useQuery({ queryKey: ['analytics', 'cost_by_service'], queryFn: () => analyticsApi.costByService() });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Costs</h1>
        <div className="flex gap-1 bg-bg-surface rounded-lg p-1 border border-border-default">
          {['day', 'week', 'month'].map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md capitalize ${period === p ? 'bg-bg-active text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8" data-testid="cost-metrics">
        <MetricCard label={`Total (${period})`} value={summary ? `$${summary.total.toFixed(2)}` : '—'} icon={<Wallet size={20} />} />
        <MetricCard label="By Stages" value={summary ? Object.keys(summary.by_stage).length.toString() : '—'} />
        <MetricCard label="By Services" value={summary ? Object.keys(summary.by_service).length.toString() : '—'} />
        <MetricCard label="Daily Avg" value={summary?.trend ? `$${(summary.total / Math.max(1, summary.trend.length)).toFixed(4)}` : '—'} />
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {summary?.by_stage && <CostByStage data={summary.by_stage} />}
        {byService && <CostByService data={byService} />}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {summary?.trend && <DailyTrend data={summary.trend} />}
      </div>
    </div>
  );
}

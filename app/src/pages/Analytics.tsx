import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { MetricCard } from '../components/shared/MetricCard';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/analytics';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

const PILLAR_COLORS: Record<string, string> = {
  ai_magic: '#818cf8',
  parenting_insights: '#b74780',
  tech_for_moms: '#22d3ee',
  mom_health: '#f472b6',
  trending: '#fbbf24',
};

const FORMAT_COLORS: Record<string, string> = {
  tiktok_slideshow: '#b74780',
  tiktok_text: '#cf5494',
  ig_carousel: '#818cf8',
  ig_static: '#60a5fa',
  ig_meme: '#fbbf24',
  video_script: '#2dd4a0',
};

function PillarChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));
  if (chartData.length === 0) return null;

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Content by Pillar</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={PILLAR_COLORS[entry.name.replace(/ /g, '_')] || '#6b6b70'} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function FormatChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));
  if (chartData.length === 0) return null;

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Content by Format</h3>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={FORMAT_COLORS[entry.name.replace(/ /g, '_')] || '#6b6b70'} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));
  const STATUS_COLORS: Record<string, string> = { draft: '#6b6b70', approved: '#60a5fa', rejected: '#ef4444', 'pending approval': '#f5a623' };

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Pipeline Status</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#2c2c30" />
          <XAxis type="number" tick={{ fill: '#9a9a9f', fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#9a9a9f', fontSize: 11 }} width={100} />
          <Tooltip contentStyle={{ background: '#1a1a1e', border: '1px solid #2c2c30', borderRadius: 8, color: '#f0f0f0', fontSize: 12 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#b74780'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostTrend({ data }: { data: { date: string; total: number }[] }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((d) => ({ date: d.date.slice(5), cost: Number(d.total.toFixed(4)) }));

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-5">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-4">Daily Cost Trend</h3>
      <ResponsiveContainer width="100%" height={220}>
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

export default function Analytics() {
  const [period, setPeriod] = useState('week');
  const { data: stats } = useQuery({ queryKey: ['analytics', 'pipeline'], queryFn: () => analyticsApi.pipelineStats() });
  const { data: costs } = useQuery({ queryKey: ['analytics', 'cost', period], queryFn: () => analyticsApi.costSummary(period) });

  const approvalRate = stats ? ((stats.byStatus?.approved || 0) / Math.max(1, stats.total) * 100).toFixed(0) : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Analytics</h1>
        <div className="flex gap-1 bg-bg-surface rounded-lg p-1 border border-border-default">
          {['day', 'week', 'month'].map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md capitalize ${period === p ? 'bg-bg-active text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Content" value={stats?.total ?? '—'} icon={<TrendingUp size={20} />} />
        <MetricCard label="Approval Rate" value={`${approvalRate}%`} />
        <MetricCard label={`Cost (${period})`} value={costs ? `$${costs.total.toFixed(2)}` : '—'} />
        <MetricCard label="Avg Cost/Post" value={costs && stats ? `$${(costs.total / Math.max(1, stats.total)).toFixed(4)}` : '—'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {stats?.byPillar && <PillarChart data={stats.byPillar} />}
        {stats?.byFormat && <FormatChart data={stats.byFormat} />}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {stats?.byStatus && <StatusChart data={stats.byStatus} />}
        {costs?.trend && <CostTrend data={costs.trend} />}
      </div>
    </div>
  );
}

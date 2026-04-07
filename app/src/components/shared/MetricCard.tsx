import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down' | 'flat';
  icon?: React.ReactNode;
  onClick?: () => void;
  'data-testid'?: string;
}

export function MetricCard({ label, value, change, trend, icon, onClick, ...rest }: Props) {
  const trendColor = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-error' : 'text-text-tertiary';
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <div onClick={onClick} data-testid={rest['data-testid']} className={`bg-bg-surface border border-border-default rounded-lg p-6 ${onClick ? 'cursor-pointer hover:bg-bg-hover transition-colors' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">{label}</span>
        {icon && <span className="text-text-tertiary">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-text-primary tabular-nums">{value}</div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${trendColor}`}>
          <TrendIcon size={14} />
          <span>{change > 0 ? '+' : ''}{change}%</span>
        </div>
      )}
    </div>
  );
}

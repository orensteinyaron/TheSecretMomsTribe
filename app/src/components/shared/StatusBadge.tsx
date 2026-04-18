const STATUS_STYLES: Record<string, { bg: string; text: string; label?: string }> = {
  draft: { bg: 'bg-bg-elevated', text: 'text-text-secondary', label: 'Draft' },
  pending_approval: { bg: 'bg-[var(--warning-muted)]', text: 'text-warning', label: 'Review' },
  approved: { bg: 'bg-[var(--info-muted)]', text: 'text-info', label: 'Approved' },
  rejected: { bg: 'bg-[var(--error-muted)]', text: 'text-error', label: 'Rejected' },
  published: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Published' },
  pending: { bg: 'bg-bg-elevated', text: 'text-text-secondary', label: 'Pending' },
  rendering: { bg: 'bg-[var(--accent-muted)]', text: 'text-accent', label: 'Rendering' },
  blocked: { bg: 'bg-[var(--warning-muted)]', text: 'text-warning', label: 'Blocked' },
  complete: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Complete' },
  failed: { bg: 'bg-[var(--error-muted)]', text: 'text-error', label: 'Failed' },
  qa_failed: { bg: 'bg-[var(--error-muted)]', text: 'text-error', label: 'QA Failed' },
  idle: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Idle' },
  running: { bg: 'bg-[var(--info-muted)]', text: 'text-info', label: 'Running' },
  disabled: { bg: 'bg-bg-elevated', text: 'text-text-tertiary', label: 'Disabled' },
  timeout: { bg: 'bg-[var(--error-muted)]', text: 'text-error', label: 'Timeout' },
  completed: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Completed' },
  active: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Active' },
  no_key: { bg: 'bg-bg-elevated', text: 'text-text-tertiary', label: 'No Key' },
  rate_limited: { bg: 'bg-[var(--warning-muted)]', text: 'text-warning', label: 'Rate Limited' },
  not_configured: { bg: 'bg-bg-elevated', text: 'text-text-tertiary', label: 'Not Configured' },
  hypothesis: { bg: 'bg-[var(--info-muted)]', text: 'text-info', label: 'Hypothesis' },
  confirmed: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Confirmed' },
  applied: { bg: 'bg-[var(--accent-muted)]', text: 'text-accent', label: 'Applied' },
  invalidated: { bg: 'bg-bg-elevated', text: 'text-text-tertiary', label: 'Invalidated' },
  executed: { bg: 'bg-[var(--success-muted)]', text: 'text-success', label: 'Executed' },
  expired: { bg: 'bg-bg-elevated', text: 'text-text-tertiary', label: 'Expired' },
};

interface Props { status: string | null | undefined; label?: string; size?: 'sm' | 'md'; }

export function StatusBadge({ status, label, size = 'sm' }: Props) {
  const safeStatus = status ?? '';
  const style = STATUS_STYLES[safeStatus] || { bg: 'bg-bg-elevated', text: 'text-text-secondary' };
  const displayLabel = label || style.label || (safeStatus ? safeStatus.replace(/_/g, ' ') : '—');
  const sizeClass = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span className={`${style.bg} ${style.text} ${sizeClass} font-semibold tracking-wide uppercase rounded-full inline-flex items-center`}>
      {displayLabel}
    </span>
  );
}

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Camera, Music2, RotateCcw, Clock, Zap } from 'lucide-react';
import { StatusBadge } from '../components/shared/StatusBadge';
import { PillarBadge } from '../components/shared/PillarBadge';
import { EditableField } from '../components/shared/EditableField';
import { useContentUpdate } from '../hooks/useContent';
import { contentApi } from '../api/content';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import type { ContentPillar, PromptExecution, PiecePagePayload } from '../types';

const PILLAR_CHOICES: ContentPillar[] = [
  'parenting', 'health', 'ai_magic', 'tech', 'trending', 'financial', 'uncategorized',
];

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const updateMutation = useContentUpdate();

  // Single request loads the whole page (spec §6.2).
  const { data: payload, isLoading } = useQuery<PiecePagePayload>({
    queryKey: ['piece', id],
    queryFn: () => contentApi.getPiecePayload(id!),
    enabled: !!id,
  });

  const renderMutation = useMutation({
    mutationFn: (contentId: string) => contentApi.triggerRender(contentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piece', id] }),
  });

  const pillarMutation = useMutation({
    mutationFn: (pillar: ContentPillar) => contentApi.patchPillar(id!, pillar),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piece', id] }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (upd: { scheduled_at_ig?: string | null; scheduled_at_tt?: string | null }) =>
      contentApi.patchSchedule(id!, upd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piece', id] }),
  });

  const regenMutation = useMutation({
    mutationFn: (params: { stepName: string; editedPrompt?: string }) =>
      contentApi.regenerateFromStep(id!, params.stepName, params.editedPrompt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piece', id] }),
  });

  if (isLoading || !payload) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-bg-surface rounded animate-pulse" />
        <div className="h-64 bg-bg-surface rounded-lg animate-pulse" />
      </div>
    );
  }

  const { piece, generation_context, render, prompt_chain, metrics, schedule } = payload;

  const approve = () => updateMutation.mutate({ id: piece.id, status: 'approved' });
  const reject = () => updateMutation.mutate({ id: piece.id, status: 'rejected' });
  const backToDraft = () => updateMutation.mutate({ id: piece.id, status: 'draft', rejection_reason: null });
  const triggerRender = () => renderMutation.mutate(piece.id);

  const channelsLit = piece.channel_override === 'ig_only'
    ? { ig: true, tt: false }
    : piece.channel_override === 'tt_only'
    ? { ig: false, tt: true }
    : { ig: true, tt: true };

  const isPublished = Boolean(piece.published_at_ig || piece.published_at_tt);

  return (
    <div>
      {/* Section 1 — Header (always visible) */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/pipeline')} className="p-1.5 rounded-md hover:bg-bg-hover text-text-secondary" data-testid="back-to-pipeline">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-text-primary tracking-tight truncate">{piece.hook}</h1>
          <div className="flex items-center gap-2 mt-1">
            {/* Editable pillar dropdown */}
            <select
              value={piece.content_pillar}
              onChange={(e) => pillarMutation.mutate(e.target.value as ContentPillar)}
              className="bg-transparent border-none text-xs p-0 focus:ring-0 cursor-pointer"
              data-testid="pillar-dropdown"
              title="Reassign pillar"
            >
              {PILLAR_CHOICES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <PillarBadge pillar={piece.content_pillar} />
            {piece.post_format && (
              <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary">
                {piece.post_format.replace(/_/g, ' ')}
              </span>
            )}
            <StatusBadge status={piece.status} />
            {piece.render_status && piece.render_status !== 'pending' && <StatusBadge status={piece.render_status} />}
            {/* Dual-channel indicator */}
            <div className="flex items-center gap-1 ml-2" data-testid="channel-indicator" title={piece.channel_override ? `Channel override: ${piece.channel_override}` : 'Both channels'}>
              <Camera size={14} className={channelsLit.ig ? 'text-pink-400' : 'text-text-tertiary opacity-40'} />
              <Music2 size={14} className={channelsLit.tt ? 'text-text-primary' : 'text-text-tertiary opacity-40'} />
            </div>
            <span className="text-xs text-text-tertiary ml-2">{new Date(piece.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {(piece.status === 'approved' || piece.status === 'rejected') && (
            <button onClick={backToDraft} className="flex items-center gap-1.5 bg-bg-elevated text-text-secondary text-sm font-medium px-4 py-2 rounded-md border border-border-default hover:bg-bg-hover">
              <RefreshCw size={16} /> Back to Draft
            </button>
          )}
          {piece.status !== 'approved' && (
            <button onClick={approve} className="flex items-center gap-1.5 bg-accent text-text-inverse text-sm font-medium px-4 py-2 rounded-md hover:bg-accent-hover" data-testid="approve-button">
              <Check size={16} /> Approve
            </button>
          )}
          {piece.status !== 'rejected' && (
            <button onClick={reject} className="flex items-center gap-1.5 bg-bg-elevated text-error text-sm font-medium px-4 py-2 rounded-md border border-error/30 hover:bg-error/10">
              <X size={16} /> Reject
            </button>
          )}
        </div>
      </div>

      {/* Section 2 — Scheduling */}
      <Section title="Scheduling" testId="section-scheduling" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-6">
          <ChannelSchedule
            channel="ig"
            label="Instagram"
            Icon={Camera}
            scheduledAt={schedule.scheduled_at_ig}
            publishedAt={schedule.published_at_ig}
            publishedUrl={schedule.published_url_ig}
            nextSlot={schedule.next_available_slot_ig}
            onSchedule={(iso) => scheduleMutation.mutate({ scheduled_at_ig: iso })}
            disabled={!channelsLit.ig}
          />
          <ChannelSchedule
            channel="tt"
            label="TikTok"
            Icon={Music2}
            scheduledAt={schedule.scheduled_at_tt}
            publishedAt={schedule.published_at_tt}
            publishedUrl={schedule.published_url_tt}
            nextSlot={schedule.next_available_slot_tt}
            onSchedule={(iso) => scheduleMutation.mutate({ scheduled_at_tt: iso })}
            disabled={!channelsLit.tt}
          />
        </div>
      </Section>

      {/* Section 3 — Generation */}
      <Section title="Generation" testId="section-generation">
        <GenerationPanel context={generation_context} piece={piece} />
      </Section>

      {/* Section 4 — Prompt Chain */}
      <Section title={`Prompt Chain (${prompt_chain.length} step${prompt_chain.length === 1 ? '' : 's'})`} testId="section-prompt-chain">
        {prompt_chain.length === 0 ? (
          <p className="text-sm text-text-tertiary italic">No prompt executions recorded yet. New content generated after V1.1 will populate this.</p>
        ) : (
          <PromptChainList
            chain={prompt_chain}
            onRegenerate={(stepName, editedPrompt) => regenMutation.mutate({ stepName, editedPrompt })}
            regenPending={regenMutation.isPending}
          />
        )}
      </Section>

      {/* Section 5 — Render */}
      <Section title="Render" testId="section-render">
        <RenderPanel
          render={render}
          piece={piece}
          generationContext={generation_context}
          onRerender={triggerRender}
          rerenderPending={renderMutation.isPending}
        />
      </Section>

      {/* Section 6 — Analytics (published pieces only) */}
      {isPublished && (
        <Section title="Analytics" testId="section-analytics" defaultOpen={true}>
          <AnalyticsPanel metrics={metrics} />
        </Section>
      )}

      {/* Editable content fields (kept from original page) */}
      <Section title="Content" testId="section-content">
        <div className="space-y-6">
          <div>
            <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Hook</h4>
            <EditableField
              value={piece.hook}
              onSave={(v) => updateMutation.mutate({ id: piece.id, hook: v })}
              className="text-lg font-semibold text-text-primary"
            />
          </div>
          {piece.slides && piece.slides.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Slides ({piece.slides.length})</h4>
              <div className="space-y-3">
                {piece.slides.map((slide, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-xs font-bold text-text-tertiary bg-bg-elevated px-2 py-0.5 rounded mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-sm text-text-primary">{slide.text}</p>
                      <span className="text-[11px] text-text-tertiary uppercase">{slide.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Caption</h4>
            <EditableField
              value={piece.caption}
              onSave={(v) => updateMutation.mutate({ id: piece.id, caption: v })}
              multiline
              className="text-sm text-text-primary whitespace-pre-line"
            />
          </div>
          <div>
            <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Hashtags</h4>
            <div className="flex flex-wrap gap-1.5">
              {piece.hashtags?.map((tag, i) => (
                <span key={i} className="text-xs bg-bg-elevated text-info px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
          {piece.ai_magic_output && (
            <div>
              <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">AI Magic Output</h4>
              <p className="text-sm text-text-primary whitespace-pre-line">{piece.ai_magic_output}</p>
            </div>
          )}
          {piece.source_urls && piece.source_urls.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-2">Sources</h4>
              <div className="space-y-2">
                {piece.source_urls.map((src, idx) => (
                  <a key={idx} href={src.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-text-secondary hover:text-accent transition-colors group">
                    <span className="capitalize text-xs text-text-tertiary w-20">{src.source?.replace(/_/g, ' ') || 'source'}</span>
                    <span className="truncate text-xs text-text-secondary group-hover:text-accent">{src.url}</span>
                    <ExternalLink size={12} className="flex-shrink-0 text-text-tertiary group-hover:text-accent" />
                  </a>
                ))}
              </div>
            </div>
          )}
          {piece.rejection_reason && (
            <div className="bg-bg-surface border border-error/30 rounded-lg p-4">
              <h4 className="text-[11px] font-semibold tracking-wide uppercase text-error mb-2">Rejection Reason</h4>
              <p className="text-sm text-text-primary">{piece.rejection_reason}</p>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

// ---------- Subsections -----------------------------------------------------

function Section({ title, testId, defaultOpen = false, children }: { title: string; testId?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-bg-surface border border-border-default rounded-lg mb-4" data-testid={testId}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-6 py-4 text-left hover:bg-bg-hover rounded-t-lg"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <h3 className="text-sm font-semibold tracking-wide uppercase text-text-secondary">{title}</h3>
      </button>
      {open && <div className="px-6 pb-6 pt-2">{children}</div>}
    </div>
  );
}

function ChannelSchedule({
  label, Icon, scheduledAt, publishedAt, publishedUrl, nextSlot, onSchedule, disabled,
}: {
  channel: 'ig' | 'tt';
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  scheduledAt: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  nextSlot: string;
  onSchedule: (iso: string | null) => void;
  disabled: boolean;
}) {
  const localForInput = (iso: string | null): string => {
    if (!iso) return '';
    // datetime-local expects YYYY-MM-DDTHH:mm (no seconds, no Z)
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return (
    <div className={`border border-border-subtle rounded-md p-4 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        {publishedAt && publishedUrl && (
          <a href={publishedUrl} target="_blank" rel="noopener" className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <ExternalLink size={12} /> Published
          </a>
        )}
      </div>
      {publishedAt ? (
        <div className="text-xs text-text-tertiary">
          Published at <span className="text-text-primary">{new Date(publishedAt).toLocaleString()}</span>
        </div>
      ) : (
        <>
          <input
            type="datetime-local"
            value={localForInput(scheduledAt)}
            onChange={(e) => onSchedule(e.target.value ? new Date(e.target.value).toISOString() : null)}
            disabled={disabled}
            className="bg-bg-input border border-border-default rounded-md px-2 py-1 text-sm text-text-primary disabled:cursor-not-allowed"
            data-testid={`schedule-input-${label.toLowerCase()}`}
          />
          <button
            onClick={() => onSchedule(nextSlot)}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover mt-2 disabled:cursor-not-allowed"
          >
            <Clock size={12} /> Next available: {new Date(nextSlot).toLocaleString()}
          </button>
        </>
      )}
    </div>
  );
}

function GenerationPanel({ context, piece }: { context: PiecePagePayload['generation_context']; piece: PiecePagePayload['piece'] }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [directivesOpen, setDirectivesOpen] = useState(false);
  if (!context) {
    return <p className="text-sm text-text-tertiary italic">No generation context recorded. This piece was created before the generation_context field was added; new pieces after V1.1 will populate this section.</p>;
  }
  return (
    <div className="space-y-4 text-sm">
      {/* Reconstructed banner — see agents/lib/prompt_logger.js JSDoc + V2 §4 conventions.
          When generation_context._reconstructed === true, the data below is synthesized
          from indirect sources (briefing + content_assets + skill md), not real-time logged.
          Per-field gaps live in _<field>_note keys; the top-level _reconstructed_note explains
          provenance. */}
      {context._reconstructed && (
        <div className="bg-bg-elevated border-l-2 border-text-tertiary text-text-secondary text-xs px-3 py-2 rounded-sm">
          <strong className="text-text-primary">Reconstructed</strong> — original LLM call data not recoverable.
          {context._reconstructed_note && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-text-tertiary hover:text-text-secondary">Provenance</summary>
              <p className="text-[11px] text-text-tertiary mt-1 whitespace-pre-line">{context._reconstructed_note}</p>
            </details>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        <StatCell label="Model" value={context.model} />
        <StatCell label="Tokens in" value={context.tokens_in?.toLocaleString() ?? '—'} />
        <StatCell label="Tokens out" value={context.tokens_out?.toLocaleString() ?? '—'} />
        <StatCell label="Cost" value={context.cost_usd != null ? `$${context.cost_usd.toFixed(4)}` : '—'} />
        <StatCell label="Pillar input" value={context.pillar_input ?? '—'} />
        <StatCell label="Format input" value={context.format_input ?? '—'} />
      </div>

      {context.briefing_id && (
        <div>
          <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-1">Briefing</h4>
          <a href={`/briefings/${context.briefing_id}`} className="text-xs text-accent">briefing {context.briefing_id.slice(0, 8)}…</a>
          {piece.source_urls && piece.source_urls.length > 0 && (
            <div className="mt-1 text-xs text-text-tertiary">{piece.source_urls.length} source URL(s) linked</div>
          )}
        </div>
      )}

      <div>
        <button onClick={() => setDirectivesOpen((o) => !o)} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
          {directivesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Active directives at generation time ({context.active_directives?.length || 0})
        </button>
        {directivesOpen && (
          <div className="mt-2 space-y-1 pl-4 border-l border-border-subtle">
            {(context.active_directives || []).map((d, i) => (
              <div key={i} className="text-xs">
                <span className="text-text-tertiary">[{d.directive_type}]</span> {d.directive}
              </div>
            ))}
            {(context.active_directives || []).length === 0 && <span className="text-xs text-text-tertiary italic">none</span>}
          </div>
        )}
      </div>

      <div>
        <button onClick={() => setPromptOpen((o) => !o)} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
          {promptOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Full generation prompt
        </button>
        {promptOpen && (
          <div className="mt-2 space-y-3">
            <div>
              <h5 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-1">System prompt</h5>
              <pre className="text-[11px] whitespace-pre-wrap bg-bg-elevated rounded p-3 max-h-64 overflow-auto">{context.system_prompt}</pre>
            </div>
            <div>
              <h5 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-1">User prompt</h5>
              <pre className="text-[11px] whitespace-pre-wrap bg-bg-elevated rounded p-3 max-h-64 overflow-auto">{context.user_prompt}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-text-tertiary uppercase tracking-wide">{label}</div>
      <div className="text-sm text-text-primary">{value}</div>
    </div>
  );
}

function PromptChainList({
  chain,
  onRegenerate,
  regenPending,
}: {
  chain: PromptExecution[];
  onRegenerate: (stepName: string, editedPrompt?: string) => void;
  regenPending: boolean;
}) {
  // Group by step_name → keep all versions; active = not referenced by any supersedes_id.
  const supersededIds = new Set(chain.map((r) => r.supersedes_id).filter(Boolean) as string[]);
  const groups = new Map<string, PromptExecution[]>();
  for (const r of chain) {
    const key = r.step_name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[1][0].step_order - b[1][0].step_order);

  return (
    <ol className="space-y-3">
      {sortedGroups.map(([stepName, versions]) => {
        const active = versions.find((v) => !supersededIds.has(v.id)) ?? versions[versions.length - 1];
        return (
          <StepCard
            key={stepName}
            stepName={stepName}
            active={active}
            versions={versions}
            onRegenerate={onRegenerate}
            regenPending={regenPending}
          />
        );
      })}
    </ol>
  );
}

function StepCard({
  stepName, active, versions, onRegenerate, regenPending,
}: {
  stepName: string;
  active: PromptExecution;
  versions: PromptExecution[];
  onRegenerate: (stepName: string, editedPrompt?: string) => void;
  regenPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(active.user_prompt);
  const [historyOpen, setHistoryOpen] = useState(false);

  const versionCount = versions.length;
  // Reconstructed rows get a dashed border so they're visually distinct from
  // real-time-logged rows. Per agents/lib/prompt_logger.js JSDoc + the cost-data
  // honesty conventions established by PR #21 — synthetic data must look synthetic.
  const isReconstructed = active.status === 'reconstructed';
  // Cost-data conventions (PR #21): cost_usd=null + a _cost_omitted_note in
  // output_json means "synthesized — kept out of the chain"; cost_usd=number +
  // a _cost_derived_from note means "real-artifact-derived." Surface both via hover.
  const costOmittedNote: string | undefined = active.output_json?._cost_omitted_note;
  const costDerivedNote: string | undefined = active.output_json?._cost_derived_from;
  return (
    <li className={`border ${isReconstructed ? 'border-dashed border-text-tertiary/40' : 'border-border-subtle'} rounded-md overflow-hidden`}>
      <div className="flex items-start gap-3 p-3">
        <span className="text-[11px] font-bold bg-bg-elevated rounded px-2 py-0.5 mt-0.5">{active.step_order}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setExpanded((e) => !e)} className="text-sm font-medium text-text-primary hover:text-accent">
              {expanded ? <ChevronDown size={12} className="inline" /> : <ChevronRight size={12} className="inline" />}
              {' '}{stepName}
            </button>
            <span className="text-[10px] text-text-tertiary uppercase">{active.model}</span>
            <StatusBadge status={active.status} />
            {versionCount > 1 && (
              <span className="text-[10px] font-semibold bg-accent/15 text-accent px-1.5 py-0.5 rounded">v{versionCount}</span>
            )}
            {active.latency_ms != null && <span className="text-[10px] text-text-tertiary">{active.latency_ms}ms</span>}
            <span
              className="text-[10px] text-text-tertiary"
              title={
                active.cost_usd == null
                  ? (costOmittedNote ?? 'Cost not recorded.')
                  : (costDerivedNote ?? undefined)
              }
            >
              {active.cost_usd != null ? `$${Number(active.cost_usd).toFixed(4)}` : '—'}
            </span>
          </div>
          {active.error_message && <div className="text-xs text-error mt-1">{active.error_message}</div>}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setEditing((e) => !e)}
            disabled={regenPending}
            className="flex items-center gap-1 text-xs bg-bg-elevated text-text-secondary px-2 py-1 rounded border border-border-default hover:bg-bg-hover disabled:opacity-50"
            title="Edit prompt & regenerate"
          >
            Edit prompt
          </button>
          <button
            onClick={() => onRegenerate(stepName)}
            disabled={regenPending}
            className="flex items-center gap-1 text-xs bg-accent/20 text-accent px-2 py-1 rounded hover:bg-accent/30 disabled:opacity-50"
            title="Re-run this step with current prompt"
            data-testid={`regenerate-${stepName}`}
          >
            <Zap size={12} /> Regenerate
          </button>
        </div>
      </div>
      {editing && (
        <div className="border-t border-border-subtle p-3 bg-bg-elevated/30">
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className="w-full min-h-32 bg-bg-input border border-border-default rounded-md p-2 text-xs font-mono text-text-primary"
            data-testid={`edit-prompt-${stepName}`}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => { onRegenerate(stepName, editedPrompt); setEditing(false); }}
              disabled={regenPending}
              className="text-xs bg-accent text-text-inverse px-3 py-1.5 rounded hover:bg-accent-hover"
            >
              <Zap size={12} className="inline" /> Regenerate with edits
            </button>
            <button onClick={() => { setEditing(false); setEditedPrompt(active.user_prompt); }} className="text-xs bg-bg-elevated text-text-secondary px-3 py-1.5 rounded border border-border-default">
              Cancel
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="border-t border-border-subtle p-3 space-y-2 bg-bg-elevated/10">
          {active.system_prompt && (
            <details>
              <summary className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary cursor-pointer">System prompt</summary>
              <pre className="text-[11px] whitespace-pre-wrap bg-bg-elevated rounded p-2 max-h-48 overflow-auto mt-1">{active.system_prompt}</pre>
            </details>
          )}
          <details>
            <summary className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary cursor-pointer">User prompt</summary>
            <pre className="text-[11px] whitespace-pre-wrap bg-bg-elevated rounded p-2 max-h-48 overflow-auto mt-1">{active.user_prompt}</pre>
          </details>
          {active.rendered_output && (
            <details>
              <summary className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary cursor-pointer">Output</summary>
              <pre className="text-[11px] whitespace-pre-wrap bg-bg-elevated rounded p-2 max-h-48 overflow-auto mt-1">{active.rendered_output.slice(0, 4000)}</pre>
            </details>
          )}
        </div>
      )}
      {versionCount > 1 && (
        <div className="border-t border-border-subtle px-3 py-2 bg-bg-elevated/10">
          <button onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary">
            <RotateCcw size={10} /> History ({versionCount - 1} superseded)
            {historyOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1 pl-4 border-l border-border-subtle">
              {versions.filter((v) => v.id !== active.id).map((v, i) => (
                <li key={v.id} className="text-[11px] text-text-tertiary">
                  v{i + 1}: {new Date(v.created_at).toLocaleString()} — {v.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function RenderPanel({
  render, piece, generationContext, onRerender, rerenderPending,
}: {
  render: PiecePagePayload['render'];
  piece: PiecePagePayload['piece'];
  generationContext: PiecePagePayload['generation_context'];
  onRerender: () => void;
  rerenderPending: boolean;
}) {
  const { queue_row, profile, output_urls, qa_score, cost_usd } = render;
  // _estimated_cost_breakdown is the budget-honesty surface for reconstructed pieces:
  // render_cost_usd reflects only logged-cost rows, the breakdown shows un-logged
  // estimates separately. See agents/lib/prompt_logger.js JSDoc cost-data conventions.
  const costBreakdown = generationContext?._estimated_cost_breakdown;
  // Drive `/preview` URLs only embed in <iframe>, not <video>. The edge function's
  // resolveOutputUrls (V2 §4.3.1) rewrites Drive webViewLinks to /preview before
  // returning them in output_urls.video; we detect that here to pick the right element.
  const isDriveVideo = !!output_urls.video && output_urls.video.includes('drive.google.com');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3 text-sm">
        <StatCell label="Status" value={queue_row.render_status || '—'} />
        <StatCell label="Profile" value={profile?.name || '—'} />
        <StatCell label="Duration" value={queue_row.render_started_at && queue_row.render_completed_at
          ? `${((new Date(queue_row.render_completed_at).getTime() - new Date(queue_row.render_started_at).getTime()) / 1000).toFixed(1)}s`
          : '—'} />
        <div>
          <div className="text-[10px] text-text-tertiary uppercase tracking-wide">Cost</div>
          <div className="text-sm text-text-primary flex items-center gap-1">
            {cost_usd != null ? `$${Number(cost_usd).toFixed(4)}` : '—'}
            {costBreakdown && (
              <span
                className="text-text-tertiary text-[11px] cursor-help"
                title={`+ $${Number(costBreakdown.total_estimated).toFixed(2)} in unlogged phases. ${costBreakdown.note}`}
                aria-label="Estimated cost breakdown"
              >
                ⓘ
              </span>
            )}
          </div>
        </div>
        {qa_score != null && <StatCell label="QA score" value={`${qa_score}/10`} />}
      </div>

      {/* Inline preview per spec §8.2 Section 5. Drive `/preview` URLs need an
          <iframe> (Drive serves embed HTML there); legacy Supabase Storage MP4s
          render natively in <video>. The edge function's resolveOutputUrls
          (V2 §4.3.1) handles the URL rewrite. */}
      <div>
        <h4 className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary mb-2">Preview</h4>
        {output_urls.video ? (
          isDriveVideo ? (
            <iframe
              src={output_urls.video}
              allow="autoplay"
              allowFullScreen
              className="w-full max-w-md aspect-[9/16] rounded-md border-0"
              data-testid="render-preview-video"
              title="Rendered video"
            />
          ) : (
            <video src={output_urls.video} controls className="w-full max-w-md rounded-md" data-testid="render-preview-video" />
          )
        ) : output_urls.carousel_slides && output_urls.carousel_slides.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto" data-testid="render-preview-carousel">
            {output_urls.carousel_slides.map((url, i) => (
              <img key={i} src={url} alt={`Slide ${i + 1}`} className="h-48 rounded-md" />
            ))}
          </div>
        ) : output_urls.static ? (
          <img src={output_urls.static} alt="Rendered" className="max-w-md rounded-md" data-testid="render-preview-static" />
        ) : (
          <p className="text-sm text-text-tertiary italic">No rendered asset yet.</p>
        )}
      </div>

      {queue_row.render_error && (
        <div>
          <h4 className="text-[11px] font-semibold tracking-wide uppercase text-error mb-1">Render error</h4>
          <pre className="text-xs whitespace-pre-wrap bg-bg-elevated rounded p-2 max-h-48 overflow-auto text-error">{queue_row.render_error}</pre>
        </div>
      )}

      <div className="flex gap-2">
        {piece.status === 'approved' && (
          <button
            onClick={onRerender}
            disabled={rerenderPending || queue_row.render_status === 'rendering'}
            className="flex items-center gap-1.5 text-sm bg-bg-elevated text-text-primary px-4 py-2 rounded-md border border-border-default hover:bg-bg-hover disabled:opacity-50"
            data-testid="rerender-button"
          >
            <RefreshCw size={14} className={rerenderPending ? 'animate-spin' : ''} />
            {queue_row.render_status === 'complete' ? 'Re-render' : 'Render'}
          </button>
        )}
        {output_urls.video && (
          <a href={output_urls.video} target="_blank" rel="noopener" className="flex items-center gap-1.5 text-sm bg-bg-elevated text-text-primary px-4 py-2 rounded-md border border-border-default hover:bg-bg-hover">
            <ExternalLink size={14} /> Download MP4
          </a>
        )}
      </div>
    </div>
  );
}

function AnalyticsPanel({ metrics }: { metrics: PiecePagePayload['metrics'] }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <ChannelAnalytics
        label="Instagram"
        Icon={Camera}
        latest={metrics.ig.latest}
        series={metrics.ig.series}
        saveRate={metrics.derived.save_rate_ig}
        shareRate={metrics.derived.share_rate_ig}
        engagementRate={metrics.derived.engagement_rate_ig}
        perfVsPillar={metrics.performance_vs_pillar.ig}
      />
      <ChannelAnalytics
        label="TikTok"
        Icon={Music2}
        latest={metrics.tt.latest}
        series={metrics.tt.series}
        saveRate={metrics.derived.save_rate_tt}
        shareRate={metrics.derived.share_rate_tt}
        engagementRate={metrics.derived.engagement_rate_tt}
        perfVsPillar={metrics.performance_vs_pillar.tt}
      />
    </div>
  );
}

function ChannelAnalytics({
  label, Icon, latest, series, saveRate, shareRate, engagementRate, perfVsPillar,
}: {
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  latest: any;
  series: any[];
  saveRate: number | null;
  shareRate: number | null;
  engagementRate: number | null;
  perfVsPillar: number | null;
}) {
  if (!latest) {
    return (
      <div className="border border-border-subtle rounded-md p-4">
        <div className="flex items-center gap-2 mb-3">
          <Icon size={14} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-sm text-text-tertiary italic">No metrics yet. Not scheduled or not published on this channel.</p>
      </div>
    );
  }
  return (
    <div className="border border-border-subtle rounded-md p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={14} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-[10px] text-text-tertiary">{series.length} snapshot(s) · last {new Date(latest.snapshot_at).toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <StatCell label="Views" value={(latest.views ?? 0).toLocaleString()} />
        <StatCell label="Likes" value={(latest.likes ?? 0).toLocaleString()} />
        <StatCell label="Comments" value={(latest.comments ?? 0).toLocaleString()} />
        <StatCell label="Shares" value={latest.shares != null ? latest.shares.toLocaleString() : '—'} />
        <StatCell label="Saves" value={latest.saves != null ? latest.saves.toLocaleString() : '—'} />
        <StatCell label="Reach" value={latest.reach != null ? latest.reach.toLocaleString() : '—'} />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
        <StatCell label="Engagement" value={engagementRate != null ? `${(engagementRate * 100).toFixed(2)}%` : '—'} />
        <StatCell label="Save rate" value={saveRate != null ? `${(saveRate * 100).toFixed(2)}%` : '—'} />
        <StatCell label="Share rate" value={shareRate != null ? `${(shareRate * 100).toFixed(2)}%` : '—'} />
        <StatCell label="vs pillar" value={perfVsPillar != null ? `${perfVsPillar.toFixed(2)}×` : '—'} />
      </div>
    </div>
  );
}

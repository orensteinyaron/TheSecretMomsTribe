import { useState } from 'react';
import { X } from 'lucide-react';

const CATEGORIES = [
  { value: 'weak_hook', label: 'Weak Hook', desc: "Hook doesn't grab attention" },
  { value: 'wrong_images', label: 'Wrong Images', desc: "Images don't match the topic" },
  { value: 'off_brand', label: 'Off Brand', desc: "Tone/voice doesn't feel like SMT" },
  { value: 'wrong_tone', label: 'Wrong Tone', desc: 'Too clinical / too casual / too preachy' },
  { value: 'pillar_mismatch', label: 'Pillar Mismatch', desc: "Doesn't fit the assigned pillar" },
  { value: 'wrong_format', label: 'Wrong Format', desc: 'Should be a different format' },
  { value: 'duplicate', label: 'Duplicate', desc: 'Too similar to existing content' },
  { value: 'other', label: 'Other', desc: 'Specify below' },
];

interface Props {
  onConfirm: (category: string, description: string) => void;
  onCancel: () => void;
  hookPreview?: string;
}

export function RejectModal({ onConfirm, onCancel, hookPreview }: Props) {
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-bg-surface border border-border-default rounded-lg shadow-lg w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Reject Content</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-bg-hover text-text-tertiary"><X size={18} /></button>
        </div>

        {hookPreview && (
          <p className="text-sm text-text-secondary bg-bg-elevated rounded p-2 mb-4 truncate">"{hookPreview}"</p>
        )}

        <div className="space-y-2 mb-4">
          <label className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary">Reason</label>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                category === cat.value
                  ? 'border-accent bg-[var(--accent-muted)] text-text-primary'
                  : 'border-border-default bg-bg-elevated text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <span className="text-sm font-medium">{cat.label}</span>
              <span className="text-xs text-text-tertiary ml-2">{cat.desc}</span>
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="text-[11px] font-semibold tracking-wide uppercase text-text-secondary mb-1 block">Additional Notes (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any specific feedback..."
            className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:border-border-focus focus:ring-1 focus:ring-accent/30"
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-text-secondary bg-bg-elevated rounded-md hover:bg-bg-hover">Cancel</button>
          <button
            onClick={() => category && onConfirm(category, description)}
            disabled={!category}
            className="px-4 py-2 text-sm font-medium text-text-inverse bg-error rounded-md hover:bg-red-600 disabled:opacity-40"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

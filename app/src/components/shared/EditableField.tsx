import { useState, useRef, useEffect } from 'react';
import { Pencil, Check, X } from 'lucide-react';

interface Props {
  value: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  label?: string;
  className?: string;
}

export function EditableField({ value, onSave, multiline = false, label, className = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const save = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="relative">
        {multiline ? (
          <textarea
            ref={inputRef as any}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            className={`w-full bg-bg-input border border-border-focus rounded-md px-3 py-2 text-sm text-text-primary resize-y focus:ring-1 focus:ring-accent/30 ${className}`}
            rows={4}
          />
        ) : (
          <input
            ref={inputRef as any}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            className={`w-full bg-bg-input border border-border-focus rounded-md px-3 py-2 text-sm text-text-primary focus:ring-1 focus:ring-accent/30 ${className}`}
          />
        )}
        <div className="flex gap-1 mt-1.5">
          <button onClick={save} className="flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-1 rounded hover:bg-success/20">
            <Check size={12} /> Save
          </button>
          <button onClick={cancel} className="flex items-center gap-1 text-xs text-text-tertiary bg-bg-elevated px-2 py-1 rounded hover:bg-bg-hover">
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative cursor-pointer" onClick={() => setEditing(true)}>
      <div className={`${className} pr-8`}>
        {value || <span className="text-text-tertiary italic">Empty — click to edit</span>}
      </div>
      <button className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-accent">
        <Pencil size={14} />
      </button>
    </div>
  );
}

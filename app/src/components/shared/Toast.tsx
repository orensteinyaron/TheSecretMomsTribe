import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Tiny toast primitive — top-right fixed, 4s auto-dismiss, click-to-dismiss.
// Mounted once at the app root via <ToastProvider>; pages call `useToast()` to
// push transient feedback. Three variants: success / error / info.
//
// Why hand-rolled: project deps are bare (react, react-query, lucide, recharts).
// Adding react-hot-toast / sonner for one component is more weight than this
// file. Keep it small; if needs grow (queueing position config, action buttons),
// reconsider.

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  push: (variant: ToastVariant, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = ++idRef.current;
    setToasts((curr) => [...curr, { id, variant, message }]);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" data-testid="toast-stack">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, 4000);
    return () => clearTimeout(handle);
  }, [onDismiss]);

  const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? AlertCircle : Info;
  const accent =
    toast.variant === 'success' ? 'text-success border-success/40' :
    toast.variant === 'error'   ? 'text-error border-error/40' :
                                  'text-info border-info/40';

  return (
    <div
      role="status"
      onClick={onDismiss}
      className={`pointer-events-auto flex items-start gap-2 bg-bg-elevated border ${accent} text-text-primary text-sm rounded-md px-3 py-2 shadow-lg max-w-sm cursor-pointer`}
      data-testid={`toast-${toast.variant}`}
    >
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${accent.split(' ')[0]}`} />
      <span className="flex-1">{toast.message}</span>
      <X size={14} className="mt-0.5 flex-shrink-0 text-text-tertiary" />
    </div>
  );
}

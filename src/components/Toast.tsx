import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastType = 'error' | 'success' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  leaving: boolean;
}

interface ToastContextValue {
  toast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

const DURATION: Record<ToastType, number> = {
  error: 8000,
  success: 4000,
  warning: 4000,
};

const ICONS: Record<ToastType, string> = {
  error: '❌',
  success: '✅',
  warning: '⚠️',
};

const COLORS: Record<ToastType, string> = {
  error: 'border-red-500/40 bg-red-950/80 text-red-200',
  success: 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200',
  warning: 'border-amber-500/40 bg-amber-950/80 text-amber-200',
};

let nextId = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    // Trigger leave animation first
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType) => {
      const id = nextId++;
      setToasts((prev) => {
        const next = [...prev, { id, message, type, leaving: false }];
        // Keep max 3 — remove oldest (non-leaving) first
        if (next.length > 3) {
          const idx = next.findIndex((t) => !t.leaving);
          if (idx !== -1) next.splice(idx, 1);
        }
        return next;
      });

      // Auto-dismiss
      const timer = setTimeout(() => {
        removeToast(id);
        timersRef.current.delete(id);
      }, DURATION[type]);
      timersRef.current.set(id, timer);
    },
    [removeToast]
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const handleDismiss = (id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    removeToast(id);
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container — top-right, above everything */}
      <div className="fixed top-3 right-3 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 max-w-[420px] rounded-lg border px-3 py-2.5 text-xs shadow-xl backdrop-blur-sm transition-all duration-300 ${COLORS[t.type]} ${
              t.leaving
                ? 'opacity-0 translate-x-6'
                : 'opacity-100 translate-x-0 animate-slide-in-right'
            }`}
          >
            <span className="shrink-0 mt-0.5">{ICONS[t.type]}</span>
            <span className="flex-1 leading-relaxed whitespace-pre-wrap break-all">
              {t.message}
            </span>
            <button
              onClick={() => handleDismiss(t.id)}
              className="shrink-0 text-zinc-400 hover:text-zinc-200 cursor-pointer ml-1 mt-0.5"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;

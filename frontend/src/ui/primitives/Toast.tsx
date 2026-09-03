import { useEffect } from 'react';
import { create } from 'zustand';

interface ToastState {
  message: string | null;
  kind: 'info' | 'error';
  seq: number;
  show(message: string, kind?: 'info' | 'error'): void;
  clear(): void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  seq: 0,
  show: (message, kind = 'info') => set((s) => ({ message, kind, seq: s.seq + 1 })),
  clear: () => set({ message: null }),
}));

/** 轻提示：右栏底部，3 秒后自动消失 */
export function Toast() {
  const { message, kind, seq, clear } = useToast();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, kind === 'error' ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [message, kind, seq, clear]);
  if (!message) return null;
  return (
    <div className={`tda-toast tda-toast--${kind}`} role="status">
      {message}
    </div>
  );
}

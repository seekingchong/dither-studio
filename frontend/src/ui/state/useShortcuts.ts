import { useEffect } from 'react';
import { isAnimated, useStudioStore } from '@/state';
import { playbackOf, usePlaybackStore } from '@/ui/media/playback';

interface ShortcutActions {
  open: () => void;
  exportPng: () => void;
  copyPng: () => void;
}

export function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox';
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 全局快捷键：Cmd/Ctrl+Z 撤销、Shift+Cmd/Ctrl+Z 或 Ctrl+Y 重做、Cmd+O 打开、Cmd+S 导出 PNG、Cmd+C 复制 PNG、空格播放 / 暂停 */
export function useShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const editable = inEditable(e.target);
      if (mod && key === 'z') {
        if (editable) return;
        e.preventDefault();
        if (e.shiftKey) useStudioStore.getState().redo();
        else useStudioStore.getState().undo();
        return;
      }
      if (mod && key === 'y') {
        if (editable) return;
        e.preventDefault();
        useStudioStore.getState().redo();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        actions.open();
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        actions.exportPng();
        return;
      }
      if (mod && key === 'c' && !editable && !window.getSelection()?.toString()) {
        e.preventDefault();
        actions.copyPng();
        return;
      }
      if (e.key === ' ' && !editable && !mod) {
        const { slots, view } = useStudioStore.getState();
        if (isAnimated(slots[view.activeSlot]?.media)) {
          e.preventDefault();
          usePlaybackStore.getState().update(view.activeSlot, { playing: !playbackOf(view.activeSlot).playing });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

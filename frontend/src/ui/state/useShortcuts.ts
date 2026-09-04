import { useEffect } from 'react';
import { isAnimated, useStudioStore } from '@/state';
import { playbackOf, usePlaybackStore } from '@/ui/media/playback';
import { useUiStore } from './uiStore';

interface ShortcutActions {
  open: () => void;
  exportPng: () => void;
  copyPng: () => void;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** 修饰键的显示写法，用于界面里的快捷键提示 */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

/** 界面里展示的快捷键一览（与下面的监听保持一致） */
export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: [MOD_KEY, 'O'], label: '打开媒体' },
  { keys: [MOD_KEY, 'S'], label: '导出 PNG' },
  { keys: [MOD_KEY, 'C'], label: '复制当前帧 PNG（选中的坑位）' },
  { keys: [MOD_KEY, '⇧', 'E'], label: '导出视频' },
  { keys: [MOD_KEY, 'Z'], label: '撤销' },
  { keys: [MOD_KEY, '⇧', 'Z'], label: '重做' },
  { keys: ['空格'], label: '播放 / 暂停' },
];

export function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox';
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * 全局快捷键：Cmd/Ctrl+Z 撤销、Shift+Cmd/Ctrl+Z 或 Ctrl+Y 重做、Cmd+O 打开、Cmd+S 导出 PNG、Cmd+Shift+E 导出视频、
 * Cmd+C 复制当前坑位的当前帧 PNG（焦点不在文本框且没有选中文字时）、空格播放 / 暂停。面板上不再放这些按钮。
 */
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
      if (mod && e.shiftKey && key === 'e') {
        e.preventDefault();
        const { slots, view } = useStudioStore.getState();
        if (isAnimated(slots[view.activeSlot]?.media)) useUiStore.getState().setExportVideoOpen(true);
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

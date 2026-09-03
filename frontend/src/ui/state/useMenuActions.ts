import { useEffect } from 'react';
import { usePlatform } from '@/platform';
import { isAnimated, useStudioStore } from '@/state';
import { inEditable } from './useShortcuts';
import { useUiStore } from './uiStore';

interface MenuHandlers {
  open: () => void;
  exportPng: () => void;
  copyPng: () => void;
}

/** 原生菜单动作分发：焦点在文本框里时交给浏览器的编辑命令，否则操作参数与导出 */
export function useMenuActions(handlers: MenuHandlers) {
  const platform = usePlatform();
  useEffect(() => {
    if (!platform.onMenuAction) return;
    return platform.onMenuAction((action) => {
      const editable = inEditable(document.activeElement);
      switch (action) {
        case 'open':
          handlers.open();
          break;
        case 'export-png':
          handlers.exportPng();
          break;
        case 'copy-png':
          handlers.copyPng();
          break;
        case 'export-video': {
          const { slots, view } = useStudioStore.getState();
          if (isAnimated(slots[view.activeSlot]?.media)) useUiStore.getState().setExportVideoOpen(true);
          break;
        }
        case 'undo':
          if (editable) document.execCommand('undo');
          else useStudioStore.getState().undo();
          break;
        case 'redo':
          if (editable) document.execCommand('redo');
          else useStudioStore.getState().redo();
          break;
        case 'copy':
          if (editable || window.getSelection()?.toString()) document.execCommand('copy');
          else handlers.copyPng();
          break;
      }
    });
  }, [platform, handlers]);
}

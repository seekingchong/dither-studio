import { useCallback } from 'react';
import { suggestPixelSize } from '@/engine';
import { usePlatform, type MediaFile } from '@/platform';
import { useStudioStore } from '@/state';
import { useToast } from '@/ui/primitives/Toast';
import { fileToMediaFile, loadMediaFile } from './loadMedia';

/** 打开媒体：文件对话框或拖拽。从目标坑位开始依次填入，超出坑位数的文件忽略。 */
export function useOpenMedia() {
  const platform = usePlatform();
  const show = useToast((s) => s.show);

  const acceptMediaFiles = useCallback(
    async (files: MediaFile[], startSlot?: number) => {
      const state = useStudioStore.getState();
      let target = startSlot ?? state.view.activeSlot;
      const capacity = state.slots.length - target;
      const batch = files.slice(0, Math.max(1, capacity));
      for (const file of batch) {
        try {
          const media = await loadMediaFile(file, platform);
          const store = useStudioStore.getState();
          const previous = store.slots[target]?.media;
          store.setSlotMedia(target, media);
          store.setActiveSlot(target);
          if (target === 0) store.applySuggestedPixelSize(suggestPixelSize(media.width, media.height));
          previous?.bitmap.close();
        } catch (err) {
          show(`无法打开 ${file.name}：${(err as Error).message}`, 'error');
        }
        target = Math.min(target + 1, useStudioStore.getState().slots.length - 1);
      }
    },
    [platform, show],
  );

  const openDialog = useCallback(
    async (slot?: number) => {
      const files = await platform.files.openMedia();
      if (files.length > 0) await acceptMediaFiles(files, slot);
    },
    [platform, acceptMediaFiles],
  );

  const acceptDrop = useCallback(
    async (list: FileList | File[], slot?: number) => {
      const files = await Promise.all(Array.from(list).map(fileToMediaFile));
      if (files.length > 0) await acceptMediaFiles(files, slot);
    },
    [acceptMediaFiles],
  );

  return { openDialog, acceptDrop, acceptMediaFiles };
}

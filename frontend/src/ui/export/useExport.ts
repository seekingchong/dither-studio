import { useCallback } from 'react';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { useToast } from '@/ui/primitives/Toast';
import { useFrameStore } from '@/ui/renderer/RendererContext';
import { exportFileName, frameToPngBlob } from './png';

/** 导出与复制当前坑位的 PNG */
export function useExport() {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const activeSlot = useStudioStore((s) => s.view.activeSlot);
  const media = useStudioStore((s) => s.slots[s.view.activeSlot]?.media ?? null);
  const rendered = useFrameStore((s) => s.frames[activeSlot]);
  const canExport = !!rendered && !!media;

  const exportPng = useCallback(async () => {
    if (!rendered || !media) return;
    try {
      const blob = await frameToPngBlob(rendered.frame);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const saved = await platform.files.save(bytes, exportFileName(media.name, 'png'), 'image/png');
      if (saved) show(`已导出 ${saved.path}`);
    } catch (err) {
      show(`导出失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, media, show]);

  const copyPng = useCallback(async () => {
    if (!rendered) return;
    try {
      const blob = await frameToPngBlob(rendered.frame);
      await platform.clipboard.writeImage(blob);
      show('已复制 PNG 到剪贴板');
    } catch (err) {
      show(`复制失败：${(err as Error).message}`, 'error');
    }
  }, [platform, rendered, show]);

  return { canExport, exportPng, copyPng };
}

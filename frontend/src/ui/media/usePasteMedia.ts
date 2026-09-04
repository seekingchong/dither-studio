import { useEffect } from 'react';
import { MEDIA_EXTENSIONS } from '@/platform';
import { useStudioStore } from '@/state';
import { useToast } from '@/ui/primitives/Toast';
import { inEditable } from '@/ui/state/useShortcuts';
import { useOpenMedia } from './useOpenMedia';

const EXTENSIONS = new Set<string>(MEDIA_EXTENSIONS);

/** 剪贴板里这一项算不算我们认的图片 / 视频 */
function isMedia(file: File): boolean {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
  // 访达里复制的文件有时候拿不到 MIME，退回看扩展名
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  return EXTENSIONS.has(ext);
}

/** 网页上「复制图片」拿到的 blob 没有文件名，按 MIME 补一个，后面按扩展名认类型的地方才不会抓瞎 */
function named(file: File): File {
  if (file.name) return file;
  const ext = file.type.split('/')[1]?.split('+')[0] || 'png';
  return new File([file], `粘贴的素材.${ext}`, { type: file.type });
}

/** 从剪贴板数据里挑出图片 / 视频 */
function mediaFrom(data: DataTransfer): File[] {
  // 访达 / 资源管理器里复制的文件走 files
  const files = Array.from(data.files).filter(isMedia).map(named);
  if (files.length > 0) return files;
  // 网页上复制的图片只在 items 里，files 是空的
  const out: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isMedia(file)) out.push(named(file));
  }
  return out;
}

/**
 * ⌘/Ctrl + V：把剪贴板里的图片 / 视频粘进当前选中的坑位（多个就从这个坑位往后依次填）。
 * 焦点在输入框里时不接管——那儿要粘的是文字；剪贴板里没有素材就提示一句，不做别的。
 */
export function usePasteMedia() {
  const { acceptDrop } = useOpenMedia();
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (inEditable(e.target) || !e.clipboardData) return;
      const files = mediaFrom(e.clipboardData);
      e.preventDefault();
      if (files.length === 0) {
        useToast.getState().show('剪贴板里没有图片或视频');
        return;
      }
      void acceptDrop(files, useStudioStore.getState().view.activeSlot);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptDrop]);
}

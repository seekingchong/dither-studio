import { Button, Icon } from '@/ui/primitives';

interface DropZoneProps {
  onOpen: () => void;
}

/** 空坑位：拖拽提示 + 打开按钮 */
export function DropZone({ onOpen }: DropZoneProps) {
  return (
    <div className="dropzone" data-testid="dropzone">
      <Icon name="image" size={32} className="dropzone__icon" />
      <p className="dropzone__title">拖入图片，或从本机打开</p>
      <p className="dropzone__hint">支持 PNG、JPG、WebP、GIF、HEIC</p>
      <Button variant="secondary" icon="folder" onClick={onOpen}>
        打开文件
      </Button>
    </div>
  );
}

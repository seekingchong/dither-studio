import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformProvider, type Platform } from '@/platform';
import { DitherStudio } from '@/ui/DitherStudio';
import { InterfacePreviewWindow } from '@/ui/interface-preview/InterfacePreviewWindow';
import { previewSlotFromHash } from '@/ui/interface-preview/route';
import '@/styles/fonts.css';
import '@/styles/tokens.css';
import '@/styles/app.css';
import '@/styles/theme.css';
import '@/styles/interface-preview.css';

export function mount(platform: Platform) {
  const container = document.getElementById('root');
  if (!container) throw new Error('缺少 #root 容器');
  // 地址带界面预览的 hash 时，这扇窗只画那张静态界面：不起引擎 Worker，也不碰存储
  const previewSlot = previewSlotFromHash(window.location.hash);
  createRoot(container).render(
    <StrictMode>
      {previewSlot === null ? (
        <PlatformProvider platform={platform}>
          <DitherStudio />
        </PlatformProvider>
      ) : (
        <InterfacePreviewWindow slot={previewSlot} />
      )}
    </StrictMode>,
  );
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformProvider, type Platform } from '@/platform';
import { DitherStudio } from '@/ui/DitherStudio';
import '@/styles/tokens.css';
import '@/styles/app.css';

export function mount(platform: Platform) {
  const container = document.getElementById('root');
  if (!container) throw new Error('缺少 #root 容器');
  createRoot(container).render(
    <StrictMode>
      <PlatformProvider platform={platform}>
        <DitherStudio />
      </PlatformProvider>
    </StrictMode>,
  );
}

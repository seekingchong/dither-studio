import { usePlatform } from '@/platform';

/** 根组件。M0 只放骨架，M1 填入顶栏 / 参数面板 / 预览画布。 */
export function DitherStudio() {
  const platform = usePlatform();
  return (
    <div className="app" data-platform={platform.kind}>
      <header className="topbar">
        <div className="topbar__brand">
          <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="2" y="2" width="14" height="14" rx="3" />
            <path d="M6 9h6M9 6v6" />
          </svg>
          Dither Studio
        </div>
      </header>
      <main className="panes">
        <section className="pane pane--params" aria-label="参数面板" />
        <section className="pane pane--preview" aria-label="预览" />
      </main>
    </div>
  );
}

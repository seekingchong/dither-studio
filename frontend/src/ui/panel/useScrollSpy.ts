import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/** 分区标题距锚点栏底边多少像素以内就算"到了" */
const LINE_OFFSET = 8;
/** 点击锚点后的程序滚动期间不做位置判定；滚动停下这么久后恢复 */
const SETTLE_MS = 160;

/**
 * 锚点式 tab 的滚动联动：所有分区排成一列，滚动时高亮当前最靠近顶部的分区；点某个 tab 就滚到对应分区。
 * 滚动容器是最近的 `.pane`；分区用 `data-group` 标记。
 */
export function useScrollSpy(sectionsRef: RefObject<HTMLElement | null>, barRef: RefObject<HTMLElement | null>, ids: readonly string[]) {
  const key = ids.join('|');
  const stableIds = useMemo(() => key.split('|').filter(Boolean), [key]);
  const [active, setActive] = useState<string | undefined>(stableIds[0]);
  const pending = useRef<string | null>(null);
  const settle = useRef(0);

  useEffect(() => {
    if (active && !stableIds.includes(active)) setActive(stableIds[0]);
  }, [stableIds, active]);

  useEffect(() => {
    const root = sectionsRef.current;
    const scroller = root?.closest<HTMLElement>('.pane');
    if (!root || !scroller) return;

    const compute = () => {
      if (pending.current) return;
      const barBottom = barRef.current?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top;
      const line = barBottom + LINE_OFFSET;
      let current = stableIds[0];
      for (const id of stableIds) {
        const el = root.querySelector<HTMLElement>(`[data-group="${id}"]`);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      // 滚到底时最后一个分区可能永远到不了顶部，直接算它
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = stableIds[stableIds.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (pending.current) {
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          pending.current = null;
        }, SETTLE_MS);
        return;
      }
      compute();
    };
    compute();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => compute());
    ro.observe(root);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro.disconnect();
      window.clearTimeout(settle.current);
    };
  }, [stableIds, sectionsRef, barRef]);

  const jumpTo = useCallback(
    (id: string) => {
      const el = sectionsRef.current?.querySelector<HTMLElement>(`[data-group="${id}"]`);
      if (!el) return;
      setActive(id);
      pending.current = id;
      // 目标已经在顶部时不会有 scroll 事件，这个兜底把 pending 清掉
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(() => {
        pending.current = null;
      }, SETTLE_MS * 3);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    },
    [sectionsRef],
  );

  return { active, jumpTo };
}

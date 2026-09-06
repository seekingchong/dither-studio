import { useEffect, useState } from 'react';

const currentRatio = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

/**
 * 当前屏幕的 devicePixelRatio。窗口被拖到另一块屏、或系统改了缩放时跟着更新——
 * 预览画布的后备存储按它开，缩小后的帧才能一个物理像素对一个采样点。
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(currentRatio);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    let query: MediaQueryList | null = null;
    // matchMedia 只在「离开当前 DPR」时触发一次，所以每次变化后都要按新值重新订阅
    const watch = () => {
      query?.removeEventListener('change', onChange);
      query = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
      query.addEventListener('change', onChange);
    };
    const onChange = () => {
      setDpr(currentRatio());
      watch();
    };
    watch();
    return () => query?.removeEventListener('change', onChange);
  }, []);
  return dpr;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH, VIDEO_COVER } from './design';
import { PREVIEW_CHANNEL, previewMessage, type PreviewMedia, type PreviewRequest } from './protocol';
import { TdcHome } from './TdcHome';

/** 要帧的节奏：封面在设计稿上只有 99×59，30 fps 已经很顺，再快只是白费主窗口的抓帧开销 */
const REQUEST_INTERVAL_MS = 1000 / 30;

/** 一帧要了这么久还没回来就当丢了，重新要，免得主窗口那边出岔子之后画面永远卡住 */
const REQUEST_TIMEOUT_MS = 1000;

/**
 * 界面预览窗口的根。
 *
 * 整张设计稿按原尺寸（1728×1080）画好再整体缩放到窗口里，保证与 Figma 逐像素一致；
 * 界面本身全是静态的，只有封面里的 video cover 是活的：这边按 rAF 的节奏向主窗口要帧，
 * 主窗口回传当前预览画布的位图，于是视频 / GIF 在这儿跟着主窗口一起循环播放。
 */
export function InterfacePreviewWindow({ slot }: { slot: number }) {
  const [scale, setScale] = useState(0);
  const [media, setMedia] = useState<PreviewMedia | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingAt = useRef(0);

  // 预览的是别家产品的浅色界面，不跟随本应用的深浅主题
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, []);

  // 整张画板等比缩到窗口里
  useLayoutEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / FRAME_WIDTH, window.innerHeight / FRAME_HEIGHT));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    document.title = media ? `界面预览 — ${media.name}` : '界面预览';
  }, [media]);

  // 收帧：整张放进封面容器里居中，不裁画面
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = previewMessage(event.data);
      if (!msg || msg.type !== 'frame' || msg.slot !== slot) return;
      pendingAt.current = 0;
      setMedia(msg.media);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        msg.bitmap?.close();
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!msg.bitmap) return;
      const fit = Math.min(canvas.width / msg.bitmap.width, canvas.height / msg.bitmap.height);
      const width = msg.bitmap.width * fit;
      const height = msg.bitmap.height * fit;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(msg.bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      msg.bitmap.close();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [slot]);

  // 要帧：由这边主动拉，主窗口被这扇窗盖住时 rAF 会被节流，反过来推就会卡住
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick);
      if (pendingAt.current > 0 && now - pendingAt.current < REQUEST_TIMEOUT_MS) return;
      if (now - last < REQUEST_INTERVAL_MS) return;
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0) return;
      last = now;
      pendingAt.current = now;
      const request: PreviewRequest = { channel: PREVIEW_CHANNEL, type: 'request', slot, width: canvas.width, height: canvas.height };
      try {
        opener.postMessage(request, '*');
      } catch {
        pendingAt.current = 0; // 主窗口已经关了，下一帧再试
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [slot]);

  // 弹出来的窗口，按 Esc 直接关掉
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 画布的像素数按它在屏幕上的实际大小给，缩放档位与屏幕倍率都算进去
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(VIDEO_COVER.width * scale * ratio));
  const pixelHeight = Math.max(1, Math.round(VIDEO_COVER.height * scale * ratio));

  return (
    <div className="tdc-shell">
      {/* scale 还没量出来（首帧）时先不画，免得闪一下 1:1 的大界面 */}
      {scale > 0 && (
        <div className="tdc-frame" style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <TdcHome cover={<canvas ref={canvasRef} className="tdc-cover__canvas" width={pixelWidth} height={pixelHeight} />} />
        </div>
      )}
    </div>
  );
}

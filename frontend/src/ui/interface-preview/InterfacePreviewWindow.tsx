import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH } from './design';
import { PREVIEW_CHANNEL, previewMessage, type PreviewFile, type PreviewMedia, type PreviewRequest } from './protocol';
import { TdcHome } from './TdcHome';

/** 要成品没回音时隔多久再要一次：主窗口那边可能还在导，或者第一份成品在这扇窗挂上监听之前就送到了 */
const REQUEST_RETRY_MS = 2000;

/** 封面里此刻显示的成品：PNG 用 <img>，MP4 / WebM 用 <video> */
interface Shown {
  kind: PreviewFile['kind'];
  url: string;
  format: PreviewFile['format'];
  width: number;
  height: number;
}

/** 窗口底部的状态条：正在导 / 导出失败；没事时不显示 */
interface Status {
  text: string;
  /** 视频逐帧编码的百分比；图片与失败时没有 */
  percent: number | null;
  error: boolean;
}

/**
 * 界面预览窗口的根。
 *
 * 整张设计稿按原尺寸（1728×1080）画好再整体缩放到窗口里，保证与 Figma 逐像素一致；
 * 界面本身全是静态的，只有封面里的 video cover 是活的——那儿放的是主窗口真正导出的成品：
 * 图片是导出的 PNG，视频 / GIF 是导出的 MP4（没有 H.264 编码器时 WebM）自己循环播，
 * 参数一改主窗口就重导一份送过来。看到的就是最终导出文件放进界面里的样子。
 */
export function InterfacePreviewWindow({ slot }: { slot: number }) {
  const [scale, setScale] = useState(0);
  const [media, setMedia] = useState<PreviewMedia | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const received = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
    const name = media ? `界面预览 — ${media.name}` : '界面预览';
    document.title = status ? `${name} · ${status.text}` : name;
  }, [media, status]);

  // 收成品与进度
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = previewMessage(event.data);
      if (!msg || msg.slot !== slot || msg.type === 'request') return;
      received.current = true;
      setMedia(msg.media);
      if (msg.type === 'progress') {
        const percent = msg.total > 0 ? Math.min(100, Math.round((msg.done / msg.total) * 100)) : 0;
        setStatus({ text: msg.format === 'PNG' ? '正在导出 PNG' : `正在导出 ${msg.format} ${percent}%`, percent: msg.format === 'PNG' ? null : percent, error: false });
        return;
      }
      if (msg.error) {
        // 留着上一份成品，只把原因显示出来
        setStatus({ text: `导出失败：${msg.error}`, percent: null, error: true });
        return;
      }
      setStatus(null);
      const file = msg.file;
      setShown(file ? { kind: file.kind, url: URL.createObjectURL(new Blob([file.bytes], { type: file.mime })), format: file.format, width: file.width, height: file.height } : null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [slot]);

  // 换了成品就把上一份的对象地址收回；这个清理在新地址已经挂到元素上之后才跑
  useEffect(() => {
    const url = shown?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [shown]);

  // 要成品：主窗口在开窗时就已经导起来了，这儿只是说一声「我准备好了」；没回音就隔两秒再要
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;
    const ask = () => {
      const request: PreviewRequest = { channel: PREVIEW_CHANNEL, type: 'request', slot };
      try {
        opener.postMessage(request, '*');
      } catch {
        // 主窗口已经关了
      }
    };
    ask();
    const timer = window.setInterval(() => {
      if (received.current) window.clearInterval(timer);
      else ask();
    }, REQUEST_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [slot]);

  // 视频成品自己循环播：muted 属性 React 不写进 DOM，自动播放要靠它，这儿补上再 play
  useEffect(() => {
    const el = videoRef.current;
    if (!el || shown?.kind !== 'video') return;
    el.muted = true;
    void el.play().catch(() => undefined);
  }, [shown]);

  // 弹出来的窗口，按 Esc 直接关掉
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cover = (
    <div className="tdc-cover__media" data-kind={shown?.kind ?? 'none'} data-format={shown?.format ?? ''}>
      {shown?.kind === 'image' && <img className="tdc-cover__image" src={shown.url} width={shown.width} height={shown.height} alt="" draggable={false} />}
      {shown?.kind === 'video' && <video ref={videoRef} className="tdc-cover__clip" src={shown.url} autoPlay muted loop playsInline />}
      {status?.percent !== null && status?.percent !== undefined && <span className="tdc-cover__bar" style={{ width: `${status.percent}%` }} />}
    </div>
  );

  return (
    <div className="tdc-shell">
      {/* scale 还没量出来（首帧）时先不画，免得闪一下 1:1 的大界面 */}
      {scale > 0 && (
        <div className="tdc-frame" style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <TdcHome cover={cover} />
        </div>
      )}
      {status && (
        <div className={status.error ? 'tdc-status tdc-status--error' : 'tdc-status'} role="status" data-testid="preview-status">
          {status.text}
        </div>
      )}
    </div>
  );
}

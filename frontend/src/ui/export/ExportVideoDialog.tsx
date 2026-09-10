import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { trimOf, trimRange, usePlaybackStore } from '@/ui/media/playback';
import { editOf } from '@/ui/media/sourceEdit';
import { Button, NumberField, Select, useToast } from '@/ui/primitives';
import { exportFileName } from './png';
import {
  MAX_EXPORT_SIDE,
  MIN_EXPORT_SIDE,
  scaleOptionsFor,
  sizeForHeight,
  sizeForScale,
  sizeForWidth,
  type ExportSize,
  type ResolutionMode,
} from './resolution';
import { FPS_OPTIONS, QUALITY_OPTIONS, bitrateFor, chooseEncoder, exportVideo, frameCountFor, isExportFps, type EncoderChoice, type ExportFps, type VideoQuality } from './video';

interface ExportVideoDialogProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

const MODE_OPTIONS: Array<{ value: ResolutionMode; label: string }> = [
  { value: 'scale', label: '按倍率' },
  { value: 'custom', label: '自定义' },
];

/** 导出视频对话框：分辨率（倍率 / 自定义，始终等比）、帧率、质量三档、进度、取消；完成后可保存或复制为文件 */
export function ExportVideoDialog({ open, onClose }: ExportVideoDialogProps) {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const activeSlot = useStudioStore((s) => s.view.activeSlot);
  const media = useStudioStore((s) => s.slots[s.view.activeSlot]?.media ?? null);
  const canvasWidth = useStudioStore((s) => Math.max(1, Math.round(Number(s.params['canvas.width']) || 1000)));
  const canvasHeight = useStudioStore((s) => Math.max(1, Math.round(Number(s.params['canvas.height']) || 600)));
  const playback = usePlaybackStore((s) => s.slots[activeSlot]);
  const [quality, setQuality] = useState<VideoQuality>('high');
  const [fps, setFps] = useState<ExportFps>(60);
  const [mode, setMode] = useState<ResolutionMode>('scale');
  const [scale, setScale] = useState('1');
  /** 自定义分辨率只存宽度，高度永远由画布比例推出来——等比是硬约束 */
  const [customWidth, setCustomWidth] = useState(canvasWidth);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; choice: EncoderChoice; width: number; height: number } | null>(null);
  /** 当前这组尺寸 / 帧率 / 质量会用哪个编码器：undefined 还在探，null 一个都不行 */
  const [encoder, setEncoder] = useState<EncoderChoice | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const canvas = useMemo<ExportSize>(() => ({ width: canvasWidth, height: canvasHeight }), [canvasWidth, canvasHeight]);
  const scaleOptions = useMemo(() => scaleOptionsFor(canvas), [canvas]);
  // 画布改大之后，原来选的倍率可能已经超出上限、不在档位里了：这种时候退回 1×，别显示一个给不到的倍率
  const scaleValue = scaleOptions.some((o) => o.value === scale) ? scale : '1';
  const size = mode === 'custom' ? sizeForWidth(canvas, customWidth) : sizeForScale(canvas, Number(scaleValue));
  // 从倍率切到自定义：接着当前这个尺寸往下改，别跳回画布尺寸
  const switchMode = (next: ResolutionMode) => {
    if (next === 'custom') setCustomWidth(size.width);
    setMode(next);
  };

  useEffect(() => {
    if (open) {
      // 每次打开都从当前画布尺寸起步：画布改过之后，自定义框里留着上次的旧值会误导人
      setCustomWidth(canvasWidth);
      return;
    }
    abortRef.current?.abort();
    setPhase('idle');
    setProgress([0, 0]);
    setError(null);
    setResult(null);
  }, [open, canvasWidth]);

  // 还没开始导就先探一下这组尺寸 / 帧率 / 质量会用哪个编码器，报在下面小字里：出的是 MP4 还是要降级 WebM，导之前就知道
  useEffect(() => {
    if (!open) return;
    let stale = false;
    setEncoder(undefined);
    void chooseEncoder(size.width, size.height, bitrateFor(quality, size.width, size.height, fps), fps).then((choice) => {
      if (!stale) setEncoder(choice);
    });
    return () => {
      stale = true;
    };
  }, [open, size.width, size.height, fps, quality]);

  if (!open) return null;

  const running = phase === 'running';
  // 时长：视频只出裁剪窗口那一段，GIF 是整段
  const span = media?.kind === 'video' ? trimRange(playback?.duration ?? 0, playback?.trimStart ?? 0, playback?.trimLength ?? null).length : (media?.duration ?? 0);
  const estimated = frameCountFor(span, fps);

  const start = async () => {
    const { slots, view, params, settings } = useStudioStore.getState();
    const current = slots[view.activeSlot]?.media;
    if (!current) return;
    usePlaybackStore.getState().update(view.activeSlot, { playing: false });
    // 视频只导出「原图」页裁出来的那一段；GIF 没有裁剪，整段出
    const trim = current.kind === 'video' ? trimOf(view.activeSlot) : null;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('running');
    setError(null);
    try {
      const out = await exportVideo({
        media: current,
        params,
        quality,
        fps,
        size,
        gpu: settings.gpu,
        trim: trim ? { start: trim.start, length: trim.length } : undefined,
        edit: editOf(view.activeSlot),
        signal: controller.signal,
        onProgress: (done, total) => setProgress([done, total]),
      });
      setResult(out);
      setPhase('done');
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  const mediaName = () => useStudioStore.getState().slots[useStudioStore.getState().view.activeSlot]?.media?.name;

  const save = async () => {
    if (!result) return;
    const saved = await platform.files.save(result.bytes, exportFileName(mediaName(), result.choice.ext), result.choice.mime);
    if (saved) show(`已导出 ${saved.path}`);
  };

  const copy = async () => {
    if (!result) return;
    if (platform.files.saveTemp && platform.clipboard.writeFile) {
      const saved = await platform.files.saveTemp(result.bytes, exportFileName(mediaName(), result.choice.ext));
      await platform.clipboard.writeFile(saved.path);
      show('已复制视频文件，可在 Finder 里粘贴');
    } else {
      await save();
      show('当前平台不支持复制视频，已改为下载');
    }
  };

  const [done, total] = progress;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="tda-modal-backdrop" role="presentation">
      <div className="tda-modal" role="dialog" aria-modal="true" aria-label="导出视频" data-testid="export-video-dialog">
        <h3 className="tda-modal__title">导出视频</h3>
        <p className="section__hint">按选定帧率逐帧渲染后编码，优先 H.264 MP4，平台不支持时降级为 WebM。分辨率始终等比，放大是连格子一起放大重渲，不是把成品拉大。</p>
        <div className="param-grid param-grid--2">
          <Select label="质量" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} disabled={running} data-param="export.quality" />
          <Select
            label="帧率"
            value={String(fps)}
            options={FPS_OPTIONS}
            onChange={(v) => {
              const next = Number(v);
              if (isExportFps(next)) setFps(next);
            }}
            disabled={running}
            data-param="export.fps"
          />
        </div>
        {mode === 'scale' ? (
          <div className="param-grid param-grid--2">
            <Select label="分辨率" value={mode} options={MODE_OPTIONS} onChange={switchMode} disabled={running} data-param="export.resolution" />
            <Select label="倍率" value={scaleValue} options={scaleOptions} onChange={setScale} disabled={running} data-param="export.scale" />
          </div>
        ) : (
          <div className="param-grid">
            <Select label="分辨率" value={mode} options={MODE_OPTIONS} onChange={switchMode} disabled={running} data-param="export.resolution" />
            <NumberField
              label="宽度"
              value={size.width}
              min={MIN_EXPORT_SIDE}
              max={MAX_EXPORT_SIDE}
              unit="px"
              disabled={running}
              onChange={(v) => setCustomWidth(sizeForWidth(canvas, v).width)}
              data-param="export.width"
            />
            <NumberField
              label="高度"
              value={size.height}
              min={MIN_EXPORT_SIDE}
              max={MAX_EXPORT_SIDE}
              unit="px"
              disabled={running}
              onChange={(v) => setCustomWidth(sizeForHeight(canvas, v).width)}
              data-param="export.height"
            />
          </div>
        )}
        <p className="section__hint" data-testid="export-video-size">
          输出 {size.width} × {size.height} · {fps} fps · 约 {estimated} 帧
          {encoder === undefined ? '' : encoder ? ` · ${encoder.container === 'mp4' ? 'MP4' : 'WebM'}（${encoder.label}）` : ' · 没有可用的编码器'}
        </p>
        {running && (
          <div className="tda-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="tda-progress__bar" style={{ width: `${percent}%` }} />
            <span className="tda-progress__text">
              {done} / {total} 帧
            </span>
          </div>
        )}
        {phase === 'done' && result && (
          <p className="tda-modal__status" data-testid="export-video-status">
            已编码 {result.choice.label} · {result.width} × {result.height} · {(result.bytes.length / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
        {phase === 'error' && <p className="tda-modal__status tda-modal__status--error">{error}</p>}
        <div className="tda-modal__actions">
          {running ? (
            <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
              取消
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              关闭
            </Button>
          )}
          {phase === 'done' && (
            <>
              <Button variant="secondary" icon="copy" onClick={() => void copy()}>
                复制文件
              </Button>
              <Button variant="primary" icon="download" onClick={() => void save()}>
                保存
              </Button>
            </>
          )}
          {(phase === 'idle' || phase === 'error') && (
            <Button variant="primary" icon="film" onClick={() => void start()}>
              开始导出
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

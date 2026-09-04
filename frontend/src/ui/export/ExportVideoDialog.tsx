import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '@/platform';
import { useStudioStore } from '@/state';
import { trimOf, usePlaybackStore } from '@/ui/media/playback';
import { Button, Select, useToast } from '@/ui/primitives';
import { exportFileName } from './png';
import { QUALITY_OPTIONS, exportVideo, type EncoderChoice, type VideoQuality } from './video';

interface ExportVideoDialogProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'idle' | 'running' | 'done' | 'error';

/** 导出视频对话框：质量三档、进度、取消；完成后可保存或复制为文件 */
export function ExportVideoDialog({ open, onClose }: ExportVideoDialogProps) {
  const platform = usePlatform();
  const show = useToast((s) => s.show);
  const [quality, setQuality] = useState<VideoQuality>('high');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; choice: EncoderChoice } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setPhase('idle');
      setProgress([0, 0]);
      setError(null);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const start = async () => {
    const { slots, view, params, settings } = useStudioStore.getState();
    const media = slots[view.activeSlot]?.media;
    if (!media) return;
    usePlaybackStore.getState().update(view.activeSlot, { playing: false });
    // 视频只导出「原图」页裁出来的那一段；GIF 没有裁剪，整段出
    const trim = media.kind === 'video' ? trimOf(view.activeSlot) : null;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('running');
    setError(null);
    try {
      const out = await exportVideo({
        media,
        params,
        quality,
        gpu: settings.gpu,
        trim: trim ? { start: trim.start, length: trim.length } : undefined,
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
        <p className="section__hint">按 60 fps 时间线逐帧渲染后编码，优先 H.264 MP4，平台不支持时降级为 WebM。</p>
        <div className="param-grid param-grid--2">
          <Select label="质量" value={quality} options={QUALITY_OPTIONS} onChange={setQuality} disabled={phase === 'running'} data-param="export.quality" />
        </div>
        {phase === 'running' && (
          <div className="tda-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="tda-progress__bar" style={{ width: `${percent}%` }} />
            <span className="tda-progress__text">
              {done} / {total} 帧
            </span>
          </div>
        )}
        {phase === 'done' && result && (
          <p className="tda-modal__status" data-testid="export-video-status">
            已编码 {result.choice.label} · {(result.bytes.length / 1024 / 1024).toFixed(2)} MB
          </p>
        )}
        {phase === 'error' && <p className="tda-modal__status tda-modal__status--error">{error}</p>}
        <div className="tda-modal__actions">
          {phase === 'running' ? (
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

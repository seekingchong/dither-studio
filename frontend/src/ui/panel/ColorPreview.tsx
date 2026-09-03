import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buildLevelPalette, resolvePalette, rgbToHex, type ColorMode } from '@/engine';
import { parseColorList } from '@/engine/color/palettes';
import { useStudioStore } from '@/state';

/** 颜色分区下方的色板 / 色带预览 */
export function ColorPreview() {
  const { mode, levels, dark, light, stops, preset, custom, linear, mismatch, paletteLevels } = useStudioStore(
    useShallow((s) => ({
      mode: String(s.params['color.mode']) as ColorMode,
      levels: Number(s.params['color.levels']),
      dark: String(s.params['color.tint.dark']),
      light: String(s.params['color.tint.light']),
      stops: String(s.params['color.tint.stops']),
      preset: String(s.params['color.palette.preset']),
      custom: String(s.params['color.palette.custom']),
      linear: Boolean(s.params['tone.linear']),
      mismatch: Boolean(s.params['color.mismatch']),
      paletteLevels: Number(s.params['color.palette.levels']),
    })),
  );

  const swatches = useMemo(() => {
    if (mode === 'channels') return null;
    const palette = resolvePalette(preset, custom);
    const lut = buildLevelPalette({
      mode,
      levels: mode === 'palette' ? (mismatch ? paletteLevels : palette.size) : levels,
      linear,
      tintDark: dark,
      tintLight: light,
      tintStops: parseColorList(stops),
      palette,
      mismatch,
      channelSpace: 'rgb',
    });
    const out: string[] = [];
    for (let i = 0; i < lut.length; i += 3) out.push(rgbToHex(lut[i], lut[i + 1], lut[i + 2]));
    return out;
  }, [mode, levels, dark, light, stops, preset, custom, linear, mismatch, paletteLevels]);

  if (!swatches) return null;
  const compact = swatches.length > 32;
  return (
    <div className={['swatches', compact ? 'swatches--compact' : ''].filter(Boolean).join(' ')} data-testid="color-preview" aria-label="色板预览">
      {swatches.map((hex, i) => (
        <span key={`${hex}-${i}`} className="swatch" style={{ background: hex }} title={hex} />
      ))}
      <span className="swatches__count">{swatches.length} 色</span>
    </div>
  );
}

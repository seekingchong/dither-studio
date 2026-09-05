import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PALETTE_PRESETS, buildLevelPalette, getPresetPalette, parseColorList, resolvePalette, rgbToHex, type ColorMode } from '@/engine';
import { getParamDef, styleOf, type ParamValue } from '@/params';
import { useStudioStore } from '@/state';
import { ColorPopover, Icon } from '@/ui/primitives';

const MODE_ID = 'color.mode';
const DARK_ID = 'color.tint.dark';
const LIGHT_ID = 'color.tint.light';
const STOPS_ID = 'color.tint.stops';
const PRESET_ID = 'color.palette.preset';
const CUSTOM_ID = 'color.palette.custom';
const INK_ID = 'hatch.ink';
const PAPER_ID = 'hatch.paper';
const DOT_ID = 'ink.dot';
const HT_PAPER_ID = 'ink.paper';

interface Editing {
  index: number;
  anchor: HTMLElement;
}

/** 新加的颜色：取当前最后两色的中间色，没有就给个中灰 */
function suggestNewColor(colors: string[]): string {
  if (colors.length < 2) return '#808080';
  const a = colors[colors.length - 2];
  const b = colors[colors.length - 1];
  const mix = (i: number) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2);
  return rgbToHex(mix(1), mix(3), mix(5));
}

/**
 * 颜色分区的色板：每个色块就是当前会用到的一种颜色，点开可用取色器改或直接输入色值。
 * 单色 / 灰阶 / Tint 的两端对应「暗色 / 亮色」，Tint 的中间级各自成为色带站点（灰阶改中间色会转成 Tint）；
 * Palette 直接编辑调色板里的每一色，改内置调色板会转为「自定义」。Channels 的颜色由 RGB / CMYK 原色决定，不在这里调。
 * 排线风格只有前景色（笔画）与背景色（纸）两块；网点风格是网点颜色与背景色，原图色 / CMYK 模式下只剩背景色。
 */
export function ColorSwatches() {
  const { style, ink, paper, dot, htPaper, inkMode, mode, levels, dark, light, stopsText, preset, customText, linear, setParam, setParams } = useStudioStore(
    useShallow((s) => ({
      style: styleOf(s.params),
      ink: String(s.params[INK_ID]),
      paper: String(s.params[PAPER_ID]),
      dot: String(s.params[DOT_ID]),
      htPaper: String(s.params[HT_PAPER_ID]),
      inkMode: String(s.params['ink.mode']),
      mode: String(s.params[MODE_ID]) as ColorMode,
      levels: Number(s.params['color.levels']),
      dark: String(s.params[DARK_ID]),
      light: String(s.params[LIGHT_ID]),
      stopsText: String(s.params[STOPS_ID]),
      preset: String(s.params[PRESET_ID]),
      customText: String(s.params[CUSTOM_ID]),
      linear: Boolean(s.params['tone.linear']),
      setParam: s.setParam,
      setParams: s.setParams,
    })),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const stops = useMemo(() => parseColorList(stopsText), [stopsText]);

  const model = useMemo(() => {
    if (style === 'hatch') return { kind: 'hatch' as const, colors: [ink, paper], presetLabel: '' };
    if (style === 'halftone') return { kind: 'halftone' as const, colors: inkMode === 'mono' ? [dot, htPaper] : [htPaper], presetLabel: '' };
    if (mode === 'channels') return null;
    if (mode === 'palette') {
      const source = preset === 'custom' ? parseColorList(customText) : (getPresetPalette(preset) ?? PALETTE_PRESETS[0]).colors;
      const presetDef = getParamDef(PRESET_ID);
      const presetLabel = presetDef.type === 'select' ? presetDef.options.find((o) => o.value === preset)?.label ?? preset : preset;
      return { kind: 'palette' as const, colors: source.length >= 1 ? source : ['#000000', '#FFFFFF'], presetLabel };
    }
    const lut = buildLevelPalette({
      mode,
      levels,
      linear,
      tintDark: dark,
      tintLight: light,
      tintStops: stops,
      palette: resolvePalette(preset, customText),
      mismatch: false,
      channelSpace: 'rgb',
    });
    const colors: string[] = [];
    for (let i = 0; i < lut.length; i += 3) colors.push(rgbToHex(lut[i], lut[i + 1], lut[i + 2]));
    return { kind: 'levels' as const, colors, presetLabel: '' };
  }, [style, ink, paper, dot, htPaper, inkMode, mode, levels, dark, light, stops, preset, customText, linear]);

  const colors = model?.colors ?? [];
  const count = colors.length;

  // 级数变化或切模式后色块变少，正在编辑的那块没了就收起弹层
  useEffect(() => {
    if (editing && editing.index >= count) setEditing(null);
  }, [editing, count]);

  const close = useCallback(() => setEditing(null), []);

  const titleOf = (i: number) => {
    if (model?.kind === 'hatch') return i === 0 ? '前景色' : '背景色';
    if (model?.kind === 'halftone') return count === 2 && i === 0 ? '网点颜色' : '背景色';
    if (model?.kind === 'palette') return `第 ${i + 1} 色`;
    if (i === 0) return '暗色';
    if (i === count - 1) return '亮色';
    return `第 ${i + 1} 级`;
  };

  /** 改第 i 块的颜色，落到对应参数上 */
  const applyColor = (i: number, hex: string) => {
    if (!model) return;
    if (model.kind === 'hatch') return setParam(i === 0 ? INK_ID : PAPER_ID, hex);
    if (model.kind === 'halftone') return setParam(count === 2 && i === 0 ? DOT_ID : HT_PAPER_ID, hex);
    if (model.kind === 'palette') {
      const next = colors.slice();
      next[i] = hex;
      const text = next.join(' ');
      if (preset === 'custom') setParam(CUSTOM_ID, text);
      else setParams({ [PRESET_ID]: 'custom', [CUSTOM_ID]: text });
      return;
    }
    if (i === 0) return setParam(DARK_ID, hex);
    if (i === count - 1) return setParam(LIGHT_ID, hex);
    // 中间级：Tint 且站点数正好等于中间级数时直接改那一站；否则把当前各级展开成站点，让每一级都可以单独调
    if (mode === 'tint' && stops.length === count - 2) {
      const next = stops.slice();
      next[i - 1] = hex;
      return setParam(STOPS_ID, next.join(' '));
    }
    const expanded = colors.slice(1, count - 1);
    expanded[i - 1] = hex;
    const patch: Record<string, ParamValue> = { [STOPS_ID]: expanded.join(' ') };
    if (mode !== 'tint') patch[MODE_ID] = 'tint';
    setParams(patch);
  };

  const removeColor = (i: number) => {
    if (model?.kind !== 'palette' || count <= 2) return;
    const next = colors.filter((_, k) => k !== i);
    setParams({ [PRESET_ID]: 'custom', [CUSTOM_ID]: next.join(' ') });
    setEditing(null);
  };

  const addColor = () => {
    if (model?.kind !== 'palette') return;
    const next = [...colors, suggestNewColor(colors)];
    setParams({ [PRESET_ID]: 'custom', [CUSTOM_ID]: next.join(' ') });
    // 新色块要等渲染出来才能锚定
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${next.length - 1}"]`);
      if (el) setEditing({ index: next.length - 1, anchor: el });
    });
  };

  if (!model) {
    return <p className="swatches__note">分通道模式按 RGB / CMYK 原色着色，颜色由通道决定。</p>;
  }

  const compact = count > 32;
  const editingHint =
    editing === null
      ? null
      : model.kind === 'palette' && preset !== 'custom'
        ? '修改后会转为「自定义」调色板'
        : model.kind === 'levels' && mode === 'gray' && editing.index > 0 && editing.index < count - 1
          ? '修改中间级会转为 Tint，之后每一级都能单独调'
          : null;

  return (
    <div className="swatches-editor">
      <div className={['swatches', 'swatches--editable', compact ? 'swatches--compact' : ''].filter(Boolean).join(' ')} data-testid="color-preview" aria-label="色板" ref={listRef}>
        {colors.map((hex, i) => (
          <button
            key={i}
            type="button"
            className={['swatch', 'swatch--btn', editing?.index === i ? 'is-editing' : ''].filter(Boolean).join(' ')}
            style={{ background: hex }}
            title={`${titleOf(i)} ${hex}`}
            aria-label={`${titleOf(i)} ${hex}`}
            data-index={i}
            onClick={(e) => setEditing(editing?.index === i ? null : { index: i, anchor: e.currentTarget })}
          />
        ))}
        {model.kind === 'palette' && (
          <button type="button" className="swatch swatch--add" aria-label="添加颜色" title="添加颜色" onClick={addColor}>
            <Icon name="plus" size={12} />
          </button>
        )}
        <span className="swatches__count">
          {model.kind === 'hatch' ? '前景 / 背景' : model.kind === 'halftone' ? (count === 2 ? '网点 / 背景' : '背景') : `${count} 色${model.kind === 'palette' ? ` · ${model.presetLabel}` : ''}`}
        </span>
        {model.kind === 'levels' && mode === 'tint' && stops.length > 0 && (
          <button type="button" className="swatches__link" onClick={() => setParam(STOPS_ID, '')}>
            清除中间色
          </button>
        )}
      </div>
      {editing && colors[editing.index] !== undefined && (
        <ColorPopover
          anchor={editing.anchor}
          value={colors[editing.index]}
          title={titleOf(editing.index)}
          onChange={(hex) => applyColor(editing.index, hex)}
          onClose={close}
          onRemove={model.kind === 'palette' && count > 2 ? () => removeColor(editing.index) : undefined}
          hint={editingHint}
        />
      )}
    </div>
  );
}

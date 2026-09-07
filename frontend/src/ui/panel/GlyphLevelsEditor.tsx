import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GLYPH_MAX_LEVELS, clampLevels, glyphInfo, isGlyphId, levelGray, resolveGlyphRamp, type GlyphId, type GlyphRampKind } from '@/engine';
import { getParamDef, glyphColorId, glyphShapeId, type ParamValue } from '@/params';
import { useStudioStore } from '@/state';
import { ColorPopover, Icon } from '@/ui/primitives';
import { helpForParam } from '@/ui/state/helpStore';
import { HelpLabel } from '@/ui/primitives/Help';
import { GlyphIcon } from './GlyphIcon';
import { GlyphPicker } from './GlyphPicker';

const LEVELS = Array.from({ length: GLYPH_MAX_LEVELS }, (_, i) => i + 1);

interface Picking {
  index: number;
  anchor: HTMLElement;
}

/** 明暗到灰色：这一阶代表的亮度画成一个色块 */
const grayHex = (v: number) => {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `#${n.toString(16).padStart(2, '0').repeat(3)}`;
};

/**
 * 「符号」分节顶上的阶梯表：从亮到暗一行一阶，每行是 这一阶的明暗色块 · 名字 · 形状（点开符号选择器）· 颜色（点开取色层）。
 * 形状：推荐序列下显示按阶数抽出来的那一套，改任何一阶就把整套写进 `glyph.shapeN` 并把序列切成「自定义」；
 * 自定义下直接改那一阶。颜色：分级配色下直接改那一阶；统一色下改某一阶会先把统一色铺到每一阶再转成分级配色；原图色下没有颜色列。
 */
export function GlyphLevelsEditor() {
  const { levels, ramp, colorMode, ink, shapesText, colorsText, setParam, setParams } = useStudioStore(
    useShallow((s) => ({
      levels: clampLevels(Number(s.params['glyph.levels'])),
      ramp: String(s.params['glyph.ramp']) as GlyphRampKind,
      colorMode: String(s.params['glyph.colorMode']),
      ink: String(s.params['glyph.ink']),
      shapesText: LEVELS.map((k) => String(s.params[glyphShapeId(k)])).join(' '),
      colorsText: LEVELS.map((k) => String(s.params[glyphColorId(k)])).join(' '),
      setParam: s.setParam,
      setParams: s.setParams,
    })),
  );
  const [picking, setPicking] = useState<Picking | null>(null);
  const [coloring, setColoring] = useState<Picking | null>(null);

  const storedShapes = useMemo(() => shapesText.split(' ').map((v): GlyphId => (isGlyphId(v) ? v : 'dot')), [shapesText]);
  const storedColors = useMemo(() => colorsText.split(' '), [colorsText]);
  const shapes = useMemo(() => resolveGlyphRamp({ ramp, levels, shapes: storedShapes }), [ramp, levels, storedShapes]);
  const colors = colorMode === 'source' ? null : colorMode === 'mono' ? shapes.map(() => ink) : storedColors.slice(0, levels);

  // 阶数变少后正在编辑的那一行没了就收起弹层
  useEffect(() => {
    if (picking && picking.index >= levels) setPicking(null);
    if (coloring && coloring.index >= levels) setColoring(null);
  }, [picking, coloring, levels]);

  const closePicker = useCallback(() => setPicking(null), []);
  const closeColor = useCallback(() => setColoring(null), []);

  const rampDef = getParamDef('glyph.ramp');
  const rampLabel = rampDef.type === 'select' ? rampDef.options.find((o) => o.value === ramp)?.label ?? ramp : ramp;

  /** 改第 i 阶的形状：推荐序列先整套落盘再改那一阶，顺带切成自定义 */
  const applyShape = (i: number, id: GlyphId) => {
    if (ramp === 'custom') {
      setParam(glyphShapeId(i + 1), id);
      return;
    }
    const patch: Record<string, ParamValue> = { 'glyph.ramp': 'custom' };
    shapes.forEach((s, k) => {
      patch[glyphShapeId(k + 1)] = s;
    });
    patch[glyphShapeId(i + 1)] = id;
    setParams(patch);
  };

  /** 改第 i 阶的颜色：统一色先铺到每一阶再转成分级配色 */
  const applyColor = (i: number, hex: string) => {
    if (colorMode === 'levels') {
      setParam(glyphColorId(i + 1), hex);
      return;
    }
    const patch: Record<string, ParamValue> = { 'glyph.colorMode': 'levels' };
    for (let k = 0; k < levels; k++) patch[glyphColorId(k + 1)] = ink;
    patch[glyphColorId(i + 1)] = hex;
    setParams(patch, glyphColorId(i + 1));
  };

  const levelName = (i: number) => `第 ${i + 1} 阶`;
  const toneTag = (i: number) => (i === 0 ? '最亮' : i === levels - 1 ? '最暗' : '');

  return (
    <div className="glyph-levels" data-testid="glyph-levels" data-ramp={ramp}>
      {shapes.map((id, i) => {
        const info = glyphInfo(id);
        const shapeDef = getParamDef(glyphShapeId(i + 1));
        const colorDef = getParamDef(glyphColorId(i + 1));
        // 形状的逐项解读在选择器里（停在符号上就有），不是下拉，别让浮层指去"展开下拉"
        const help = helpForParam(shapeDef, levelName(i));
        return (
          <div key={i} className="glyph-level" data-level={i + 1}>
            <span className="glyph-level__tone" style={{ background: grayHex(levelGray(i, levels)) }} title={`${levelName(i)}代表的明暗`} aria-hidden="true" />
            <HelpLabel content={help ? { ...help, more: false } : null} className="glyph-level__name">
              {levelName(i)}
              {toneTag(i) && <span className="glyph-level__tag">{toneTag(i)}</span>}
            </HelpLabel>
            <button
              type="button"
              className={['glyph-level__shape', picking?.index === i ? 'is-open' : ''].filter(Boolean).join(' ')}
              aria-haspopup="dialog"
              aria-expanded={picking?.index === i}
              aria-label={`${levelName(i)}形状 ${info.label}`}
              data-param={glyphShapeId(i + 1)}
              data-glyph={id}
              onClick={(e) => setPicking(picking?.index === i ? null : { index: i, anchor: e.currentTarget })}
            >
              <GlyphIcon id={id} size={22} />
              <span className="glyph-level__label">{info.label}</span>
              <Icon name="chevron" size={12} className="tda-select__chevron" />
            </button>
            {colors && (
              <button
                type="button"
                className={['swatch', 'swatch--btn', 'glyph-level__color', coloring?.index === i ? 'is-editing' : ''].filter(Boolean).join(' ')}
                style={{ background: colors[i] }}
                title={`${colorDef.label} ${colors[i]}`}
                aria-label={`${colorDef.label} ${colors[i]}`}
                data-param={glyphColorId(i + 1)}
                onClick={(e) => setColoring(coloring?.index === i ? null : { index: i, anchor: e.currentTarget })}
              />
            )}
          </div>
        );
      })}
      <p className="glyph-levels__note">
        {ramp === 'custom' ? '自定义序列：每一阶自己挑。想回到推荐，在「基础」里重新选一套符号序列。' : `「${rampLabel}」序列按墨量推荐的 ${levels} 阶；改任何一阶就转为自定义。`}
      </p>
      {picking && shapes[picking.index] !== undefined && (
        <GlyphPicker anchor={picking.anchor} value={shapes[picking.index]} title={levelName(picking.index)} onChange={(id) => applyShape(picking.index, id)} onClose={closePicker} />
      )}
      {coloring && colors && colors[coloring.index] !== undefined && (
        <ColorPopover
          anchor={coloring.anchor}
          value={colors[coloring.index]}
          title={`${levelName(coloring.index)}`}
          onChange={(hex) => applyColor(coloring.index, hex)}
          onClose={closeColor}
          hint={colorMode === 'mono' ? '修改后会转为「分级配色」，之后每一阶都能单独调' : null}
        />
      )}
    </div>
  );
}

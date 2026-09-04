import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import { bool, getParamDef, num, str, type ParamGroup, type Params } from '@/params';

export interface SectionMeta {
  id: string;
  label: string;
  hint: string;
  /** 这一节收哪几个 schema 分组 */
  groups: readonly ParamGroup[];
  /** 折叠时显示的当前值摘要，让人不展开也知道里面是什么 */
  summary(params: Params): string;
}

function optionLabel(id: string, params: Params): string {
  const def = getParamDef(id);
  const value = params[id];
  if (def.type !== 'select') return String(value);
  return def.options.find((o) => o.value === value)?.label ?? String(value);
}

/** 摘要最多列 3 项，多的用省略号收掉 */
function join(parts: string[], fallback: string): string {
  if (parts.length === 0) return fallback;
  return parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' …' : '');
}

const signed = (label: string, value: number) => `${label} ${value > 0 ? '+' : ''}${value}`;

/**
 * 左栏的参数分节。原来是一排 tab，一次只看得见一节；现在整栏一列，
 * 每节可折叠、收起时显示当前值摘要，几节的关系一眼可见。
 * 画布尺寸 / 适配不在这里，在预览区右上角的「画布」菜单里。
 */
export const SECTIONS: SectionMeta[] = [
  {
    id: 'basic',
    label: '基础',
    hint: '算法族决定风格的大方向，颜色模式决定用几种颜色，像素尺寸决定颗粒粗细。下面的参数随所选算法族变化。',
    groups: ['dither', 'pixel'],
    summary: (p) => {
      const family = str(p, 'dither.family') as DitherFamily;
      const algorithmId = FAMILY_PARAM[family];
      const parts = [optionLabel('dither.family', p)];
      if (algorithmId) parts.push(optionLabel(algorithmId, p));
      parts.push(`像素 ${num(p, 'pixel.size')}`);
      return parts.join(' · ');
    },
  },
  {
    id: 'tone',
    label: '影调',
    hint: '抖动之前的亮度处理。阈值给量化前的亮度加固定偏置，是 1-bit 下最重要的创意滑块。',
    groups: ['tone'],
    summary: (p) => {
      const parts: string[] = [];
      if (bool(p, 'tone.auto')) parts.push('自动调整');
      const threshold = num(p, 'tone.threshold');
      if (threshold !== 128) parts.push(`阈值 ${threshold}`);
      for (const [id, label] of [
        ['tone.brightness', '亮度'],
        ['tone.contrast', '对比'],
        ['tone.shadows', '阴影'],
        ['tone.midtones', '中间调'],
        ['tone.highlights', '高光'],
        ['tone.saturation', '饱和'],
      ] as const) {
        const v = num(p, id);
        if (v !== 0) parts.push(signed(label, v));
      }
      for (const [id, label] of [
        ['tone.blur', '模糊'],
        ['tone.sharpen', '锐化'],
        ['tone.denoise', '去噪'],
        ['tone.noise', '噪点'],
        ['tone.outline', '描边'],
      ] as const) {
        if (num(p, id) > 0) parts.push(label);
      }
      if (bool(p, 'tone.invert')) parts.push('反相');
      return join(parts, '未调整');
    },
  },
  {
    id: 'color',
    label: '颜色',
    hint: '颜色模式在「基础」里选，这里是所选模式的细节：灰阶级数、两端色、调色板、分通道，以及在结果上撒跳色的强调层。色块可以点开改颜色或直接输入色值。',
    groups: ['color'],
    summary: (p) => {
      const mode = str(p, 'color.mode');
      const parts = [optionLabel('color.mode', p)];
      if (mode === 'palette') parts.push(optionLabel('color.palette.preset', p));
      else if (mode !== 'mono') parts.push(`${num(p, 'color.levels')} 级`);
      if (mode === 'palette' && bool(p, 'color.mismatch')) parts.push('深度错配');
      if (bool(p, 'color.accent.enabled')) parts.push('强调层');
      return parts.join(' · ');
    },
  },
  {
    id: 'grid',
    label: '网格',
    hint: '把每个像素格画成网点：形状、反向、随明暗缩放；点融合让相邻网点粘连；横纵间距留出背景。像素尺寸越大越明显。',
    groups: ['grid'],
    summary: (p) => {
      const parts = [optionLabel('grid.dot', p)];
      if (bool(p, 'grid.invert')) parts.push('反向');
      if (bool(p, 'grid.metaball')) parts.push('点融合');
      const gapX = num(p, 'grid.gapX');
      const gapY = num(p, 'grid.gapY');
      if (gapX || gapY) parts.push(`间距 ${gapX}/${gapY}`);
      if (str(p, 'grid.background') !== 'none') parts.push(`${optionLabel('grid.background', p)}背景`);
      return parts.join(' · ');
    },
  },
  {
    id: 'effects',
    label: '特效',
    hint: '抖动完成后叠加的后处理，按列表顺序依次应用。点选项添加，可添加多个、调整顺序或临时关闭。',
    groups: ['effects'],
    summary: (p) => {
      const raw = str(p, 'effects.stack').trim();
      if (!raw) return '无';
      try {
        const stack = JSON.parse(raw) as unknown[];
        return Array.isArray(stack) && stack.length > 0 ? `${stack.length} 个特效` : '无';
      } catch {
        return '无';
      }
    },
  },
];

/**
 * 「基础」最前面这几个参数原来是 tab 之上单独一排"快捷参数"：算法族、当前族的算法、
 * 颜色模式、像素尺寸。tab 拆掉后它们整排并进「基础」，顺序不变，末尾补上降采样。
 * 颜色模式归在 color 分组，靠这份名单被拉到「基础」，不在「颜色」里重复出现。
 */
export function leadParamIds(family: string): string[] {
  const algorithmId = FAMILY_PARAM[family as DitherFamily];
  return ['dither.family', ...(algorithmId ? [algorithmId] : []), 'color.mode', 'pixel.size', 'pixel.method'];
}

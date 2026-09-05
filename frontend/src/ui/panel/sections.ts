import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import { bool, getParamDef, num, str, styleOf, type ParamDef, type ParamGroup, type Params } from '@/params';

export interface SectionMeta {
  id: string;
  label: string;
  /** 分节说明；两种风格下说法不同的写成函数 */
  hint: string | ((params: Params) => string);
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
 * 每节默认展开、可单独收起，收起时显示当前值摘要，几节的关系一眼可见。
 * 「颜色」紧跟「基础」：颜色模式就在「基础」那一排里选，细节挨着它才接得上，影调再往后。
 * 排线风格多一节「笔画」，紧跟「基础」——角度 / 间距 / 色阶在「基础」定大方向，这一节管每一笔长什么样；
 * 抖动风格下它没有可见参数，自动不出现，「网格」在排线下同理。
 * 画布尺寸 / 适配不在这里，在预览区右上角的「画布」菜单里。
 */
export const SECTIONS: SectionMeta[] = [
  {
    id: 'basic',
    label: '基础',
    hint: (p) =>
      styleOf(p) === 'hatch'
        ? '角度是笔画朝向，横纵间距是格子大小，色阶是粗细分几档——这三样定排线的大方向。每一笔长什么样在下一节「笔画」。'
        : '算法族决定风格的大方向，颜色模式决定用几种颜色，像素尺寸决定颗粒粗细。下面的参数随所选算法族变化。',
    groups: ['dither', 'pixel'],
    summary: (p) => {
      if (styleOf(p) === 'hatch') return `排线 · ${num(p, 'hatch.angle')}° · 间距 ${num(p, 'hatch.spacingX')}×${num(p, 'hatch.spacingY')}`;
      const family = str(p, 'dither.family') as DitherFamily;
      const algorithmId = FAMILY_PARAM[family];
      const parts = [optionLabel('dither.family', p)];
      if (algorithmId) parts.push(optionLabel(algorithmId, p));
      parts.push(`像素 ${num(p, 'pixel.size')}`);
      return parts.join(' · ');
    },
  },
  {
    id: 'hatch',
    label: '笔画',
    hint: '每一笔长什么样：长度以贯穿格子为 100%，粗细以相邻线刚好挨上为 100%，圆角决定方头还是圆头；交叉排线给暗部再叠一层垂直线；连线用一根细线把笔画串起来。',
    groups: ['hatch'],
    summary: (p) => {
      const parts = [`长 ${num(p, 'hatch.length')}%`, `粗 ${num(p, 'hatch.minWidth')}–${num(p, 'hatch.maxWidth')}%`, `圆角 ${num(p, 'hatch.roundness')}%`];
      if (bool(p, 'hatch.cross')) parts.push('交叉');
      if (str(p, 'hatch.link') !== 'none') parts.push(`连线${optionLabel('hatch.link', p)}`);
      return join(parts, '');
    },
  },
  {
    id: 'color',
    label: '颜色',
    hint: (p) =>
      styleOf(p) === 'hatch'
        ? '排线只用两种颜色：前景色是笔画，背景色是纸。色块可以点开改颜色或直接输入色值；想要浅线深底就把两色对调，再到「影调」里打开反相。'
        : '颜色模式在「基础」里选，这里是所选模式的细节：灰阶级数、两端色、调色板、分通道，以及在结果上撒跳色的强调层。色块可以点开改颜色或直接输入色值。',
    groups: ['color'],
    summary: (p) => {
      if (styleOf(p) === 'hatch') return `${str(p, 'hatch.ink')} / ${str(p, 'hatch.paper')}`;
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
    id: 'tone',
    label: '影调',
    hint: '量化之前的亮度处理，抖动与排线共用。阈值给量化前的亮度加固定偏置，是 1-bit 下最重要的创意滑块。',
    groups: ['tone'],
    summary: (p) => {
      const parts: string[] = [];
      if (bool(p, 'tone.auto')) parts.push('自动调整');
      if (bool(p, 'tone.bg.enabled')) parts.push(`强制背景 ${num(p, 'tone.bg.density')}%`);
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

/** 分节说明的当前文案 */
export function sectionHint(meta: SectionMeta, params: Params): string {
  return typeof meta.hint === 'function' ? meta.hint(params) : meta.hint;
}

/**
 * 按名单跨节摆放的参数：排线的前景 / 背景色在数据上属 `hatch` 分组（随预设一起露出），
 * 面板上却该和抖动的两端色一样待在「颜色」里。
 */
export const PINNED: Readonly<Record<string, string>> = { 'hatch.ink': 'color', 'hatch.paper': 'color' };

const sectionOfGroup = new Map<ParamGroup, string>();
for (const meta of SECTIONS) for (const group of meta.groups) sectionOfGroup.set(group, meta.id);

/** 一个参数归左栏哪一节：领头参数一律「基础」，点名的按名单，其余按分组；没有分节的分组（画布、风格）不在左栏出现 */
export function sectionOf(def: ParamDef, leads: ReadonlySet<string>): string | undefined {
  if (leads.has(def.id)) return 'basic';
  return PINNED[def.id] ?? sectionOfGroup.get(def.group);
}

/**
 * 「基础」最前面这几个参数原来是 tab 之上单独一排"快捷参数"：算法族、当前族的算法、
 * 颜色模式、像素尺寸。tab 拆掉后它们整排并进「基础」，顺序不变，末尾补上降采样。
 * 颜色模式归在 color 分组，靠这份名单被拉到「基础」，不在「颜色」里重复出现。
 * 排线风格下领头的是角度、横纵间距、色阶——排线的"算法"就是这几样。
 */
export function leadParamIds(params: Params): string[] {
  if (styleOf(params) === 'hatch') return ['hatch.angle', 'hatch.spacingX', 'hatch.spacingY', 'hatch.levels', 'pixel.method'];
  const family = str(params, 'dither.family') as DitherFamily;
  const algorithmId = FAMILY_PARAM[family];
  return ['dither.family', ...(algorithmId ? [algorithmId] : []), 'color.mode', 'pixel.size', 'pixel.method'];
}

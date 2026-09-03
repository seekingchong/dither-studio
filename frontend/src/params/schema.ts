import type { ParamDef, ParamOption } from './types';

/**
 * 参数总表。PRD 里的每个参数是一条记录；参数面板、预设序列化、撤销重做、自动调整全部从这张表推导。
 * 新增参数只加一条记录。id 用 "组.名" 形式，组名与 ParamGroup 一致。
 */

const opt = (value: string, label: string): ParamOption => ({ value, label });

export const DITHER_FAMILIES: ParamOption[] = [
  opt('threshold', '阈值'),
  opt('noise', '噪声'),
  opt('ordered', '有序'),
  opt('halftone', '半调'),
  opt('error-diffusion', '误差扩散'),
  opt('curve', '曲线扫描'),
  opt('search', '点扩散 / DBS'),
  opt('pattern', '图案'),
];

export const PARAM_SCHEMA: readonly ParamDef[] = [
  // ---------- 画布 ----------
  { id: 'canvas.width', group: 'canvas', label: '宽度', type: 'number', min: 16, max: 8192, step: 1, default: 1000, unit: 'px', advanced: true },
  { id: 'canvas.height', group: 'canvas', label: '高度', type: 'number', min: 16, max: 8192, step: 1, default: 600, unit: 'px', advanced: true },
  {
    id: 'canvas.fit',
    group: 'canvas',
    label: '适配',
    type: 'select',
    default: 'contain',
    advanced: true,
    options: [opt('contain', 'Contain'), opt('cover', 'Cover'), opt('fill', 'Fill'), opt('native', '原尺寸')],
  },

  // ---------- 像素化 ----------
  { id: 'pixel.size', group: 'pixel', label: '像素尺寸', type: 'number', min: 1, max: 64, step: 1, default: 4 },
  {
    id: 'pixel.method',
    group: 'pixel',
    label: '降采样',
    type: 'select',
    default: 'box',
    options: [opt('box', 'Box 平均'), opt('bilinear', '双线性'), opt('lanczos', 'Lanczos'), opt('nearest', '最近邻')],
  },
  { id: 'pixel.offsetX', group: 'pixel', label: '偏移 X', type: 'number', min: 0, max: 63, step: 1, default: 0, advanced: true },
  { id: 'pixel.offsetY', group: 'pixel', label: '偏移 Y', type: 'number', min: 0, max: 63, step: 1, default: 0, advanced: true },

  // ---------- 影调与预处理 ----------
  { id: 'tone.threshold', group: 'tone', label: '阈值', type: 'number', min: 0, max: 255, step: 1, default: 128 },
  { id: 'tone.invert', group: 'tone', label: '反相', type: 'boolean', default: false },
  {
    id: 'tone.grayFormula',
    group: 'tone',
    label: '灰度公式',
    type: 'select',
    default: 'bt709',
    options: [
      opt('bt709', 'BT.709'),
      opt('bt601', 'BT.601'),
      opt('average', '平均值'),
      opt('red', '红通道'),
      opt('green', '绿通道'),
      opt('blue', '蓝通道'),
      opt('max', '最大值'),
    ],
  },

  // ---------- 抖动算法 ----------
  { id: 'dither.family', group: 'dither', label: '算法族', type: 'select', default: 'error-diffusion', options: DITHER_FAMILIES },
  {
    id: 'dither.threshold.method',
    group: 'dither',
    label: '方法',
    type: 'select',
    default: 'fixed',
    visibleWhen: { id: 'dither.family', equals: 'threshold' },
    options: [opt('fixed', '固定阈值'), opt('otsu', 'Otsu 自动'), opt('adaptive', '自适应')],
  },
  {
    id: 'dither.ordered.matrix',
    group: 'dither',
    label: '矩阵',
    type: 'select',
    default: 'bayer4',
    visibleWhen: { id: 'dither.family', equals: 'ordered' },
    options: [opt('bayer2', 'Bayer 2×2'), opt('bayer3', 'Bayer 3×3'), opt('bayer4', 'Bayer 4×4'), opt('bayer8', 'Bayer 8×8'), opt('bayer16', 'Bayer 16×16'), opt('bayer32', 'Bayer 32×32')],
  },
  {
    id: 'dither.ordered.scale',
    group: 'dither',
    label: '图案缩放',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 1,
    visibleWhen: { id: 'dither.family', equals: 'ordered' },
  },
  {
    id: 'dither.ed.kernel',
    group: 'dither',
    label: '扩散核',
    type: 'select',
    default: 'floyd-steinberg',
    visibleWhen: { id: 'dither.family', equals: 'error-diffusion' },
    options: [opt('floyd-steinberg', 'Floyd–Steinberg')],
  },
  {
    id: 'dither.ed.strength',
    group: 'dither',
    label: '误差强度',
    type: 'number',
    min: 0,
    max: 100,
    step: 1,
    default: 100,
    unit: '%',
    visibleWhen: { id: 'dither.family', equals: 'error-diffusion' },
  },
  {
    id: 'dither.ed.serpentine',
    group: 'dither',
    label: '蛇形扫描',
    type: 'boolean',
    default: true,
    visibleWhen: { id: 'dither.family', equals: 'error-diffusion' },
  },

  // ---------- 颜色 ----------
  {
    id: 'color.mode',
    group: 'color',
    label: '颜色模式',
    type: 'select',
    default: 'tint',
    options: [opt('mono', '单色'), opt('gray', '灰阶'), opt('tint', 'Tint'), opt('palette', 'Palette'), opt('channels', 'Channels')],
  },
  { id: 'color.tint.dark', group: 'color', label: '暗色', type: 'color', default: '#000000', visibleWhen: { id: 'color.mode', equals: 'tint' } },
  { id: 'color.tint.light', group: 'color', label: '亮色', type: 'color', default: '#FFFFFF', visibleWhen: { id: 'color.mode', equals: 'tint' } },
];

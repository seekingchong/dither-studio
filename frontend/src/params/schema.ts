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

const fam = (family: string) => ({ id: 'dither.family', equals: family });
const famAnd = (family: string, id: string, value: string | string[]) => [
  fam(family),
  Array.isArray(value) ? { id, in: value } : { id, equals: value },
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
  { id: 'tone.auto', group: 'tone', label: '自动调整', type: 'boolean', default: false, hint: '按直方图拉伸色阶，并加一点对比与锐化，让抖动纹理更干净' },
  { id: 'tone.brightness', group: 'tone', label: '亮度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.contrast', group: 'tone', label: '对比度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.shadows', group: 'tone', label: '阴影', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.midtones', group: 'tone', label: '中间调', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.highlights', group: 'tone', label: '高光', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.saturation', group: 'tone', label: '饱和度', type: 'number', min: -100, max: 100, step: 1, default: 0 },
  { id: 'tone.blur', group: 'tone', label: '模糊', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: 'px' },
  { id: 'tone.sharpen', group: 'tone', label: '锐化', type: 'number', min: 0, max: 100, step: 1, default: 0 },
  { id: 'tone.denoise', group: 'tone', label: '去噪', type: 'number', min: 0, max: 100, step: 1, default: 0 },
  { id: 'tone.noise', group: 'tone', label: '噪点', type: 'number', min: 0, max: 100, step: 1, default: 0 },
  {
    id: 'tone.noiseType',
    group: 'tone',
    label: '噪点类型',
    type: 'select',
    default: 'gaussian',
    visibleWhen: { id: 'tone.noise', gt: 0 },
    options: [opt('gaussian', '高斯'), opt('uniform', '均匀'), opt('blue', '蓝噪声'), opt('salt-pepper', '椒盐')],
  },
  { id: 'tone.noiseSeed', group: 'tone', label: '噪点种子', type: 'number', min: 0, max: 9999, step: 1, default: 1, visibleWhen: { id: 'tone.noise', gt: 0 }, advanced: true },
  { id: 'tone.outline', group: 'tone', label: '边缘描边', type: 'number', min: 0, max: 100, step: 1, default: 0 },
  { id: 'tone.outlineThreshold', group: 'tone', label: '描边阈值', type: 'number', min: 0, max: 100, step: 1, default: 20, visibleWhen: { id: 'tone.outline', gt: 0 } },
  {
    id: 'tone.linear',
    group: 'tone',
    label: '线性空间',
    type: 'boolean',
    default: true,
    advanced: true,
    hint: '在线性光里量化，抖动后的平均亮度与原图一致；关闭后在 gamma 空间量化，中间调更亮。',
  },
  {
    id: 'tone.grayFormula',
    group: 'tone',
    label: '灰度公式',
    type: 'select',
    default: 'bt709',
    advanced: true,
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

  // 阈值
  {
    id: 'dither.threshold.method',
    group: 'dither',
    label: '方法',
    type: 'select',
    default: 'fixed',
    visibleWhen: fam('threshold'),
    options: [opt('fixed', '固定阈值'), opt('otsu', 'Otsu 自动阈值'), opt('adaptive', '自适应阈值')],
  },
  { id: 'dither.threshold.radius', group: 'dither', label: '窗口半径', type: 'number', min: 1, max: 64, step: 1, default: 8, unit: 'px', visibleWhen: famAnd('threshold', 'dither.threshold.method', 'adaptive') },
  { id: 'dither.threshold.offset', group: 'dither', label: '偏移 C', type: 'number', min: -50, max: 50, step: 1, default: 0, unit: '%', visibleWhen: famAnd('threshold', 'dither.threshold.method', 'adaptive') },

  // 噪声
  {
    id: 'dither.noise.type',
    group: 'dither',
    label: '噪声',
    type: 'select',
    default: 'blue',
    visibleWhen: fam('noise'),
    options: [opt('blue', '蓝噪声'), opt('white', '白噪声'), opt('ign', '交错梯度噪声'), opt('perlin', 'Perlin')],
  },
  { id: 'dither.noise.amplitude', group: 'dither', label: '噪声幅度', type: 'number', min: 0, max: 200, step: 1, default: 100, unit: '%', visibleWhen: fam('noise') },
  { id: 'dither.noise.scale', group: 'dither', label: '噪声尺度', type: 'number', min: 1, max: 64, step: 1, default: 1, visibleWhen: fam('noise') },
  { id: 'dither.noise.seed', group: 'dither', label: '随机种子', type: 'number', min: 0, max: 9999, step: 1, default: 1, visibleWhen: fam('noise') },

  // 有序
  {
    id: 'dither.ordered.matrix',
    group: 'dither',
    label: '矩阵',
    type: 'select',
    default: 'bayer4',
    visibleWhen: fam('ordered'),
    options: [
      opt('bayer2', 'Bayer 2×2'),
      opt('bayer3', 'Bayer 3×3'),
      opt('bayer4', 'Bayer 4×4'),
      opt('bayer8', 'Bayer 8×8'),
      opt('bayer16', 'Bayer 16×16'),
      opt('bayer32', 'Bayer 32×32'),
      opt('cluster4', '聚簇点 4×4'),
      opt('cluster8', '聚簇点 8×8'),
      opt('nonrect', '非矩形'),
      opt('centerwhite', '中心白点'),
      opt('diagonal', '对角矩阵'),
      opt('circle5', '圆点 5×5'),
      opt('circle6', '圆点 6×6'),
      opt('circle7', '圆点 7×7'),
    ],
  },
  { id: 'dither.ordered.scale', group: 'dither', label: '图案缩放', type: 'number', min: 1, max: 8, step: 1, default: 1, visibleWhen: fam('ordered') },
  { id: 'dither.ordered.angle', group: 'dither', label: '图案角度', type: 'number', min: 0, max: 180, step: 1, default: 0, unit: '°', visibleWhen: fam('ordered') },
  { id: 'dither.ordered.offsetX', group: 'dither', label: '偏移 X', type: 'number', min: 0, max: 63, step: 1, default: 0, visibleWhen: fam('ordered'), advanced: true },
  { id: 'dither.ordered.offsetY', group: 'dither', label: '偏移 Y', type: 'number', min: 0, max: 63, step: 1, default: 0, visibleWhen: fam('ordered'), advanced: true },

  // 半调
  {
    id: 'dither.halftone.shape',
    group: 'dither',
    label: '网点形状',
    type: 'select',
    default: 'round',
    visibleWhen: fam('halftone'),
    options: [
      opt('round', '圆点'),
      opt('euclidean', '欧几里得'),
      opt('line', '线'),
      opt('diamond', '菱形'),
      opt('cosine', '余弦'),
      opt('square', '方'),
      opt('ellipse', '椭圆'),
      opt('cross', '十字'),
      opt('star', '星形'),
      opt('hexagon', '六边形网格'),
    ],
  },
  { id: 'dither.halftone.period', group: 'dither', label: '网点周期', type: 'number', min: 2, max: 64, step: 1, default: 8, unit: 'px', visibleWhen: fam('halftone') },
  { id: 'dither.halftone.angle', group: 'dither', label: '网线角度', type: 'number', min: 0, max: 180, step: 1, default: 45, unit: '°', visibleWhen: fam('halftone') },
  { id: 'dither.halftone.gain', group: 'dither', label: '网点增益', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: '%', visibleWhen: fam('halftone') },
  { id: 'dither.halftone.gooey', group: 'dither', label: '融合度', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%', visibleWhen: fam('halftone') },
  { id: 'dither.halftone.invert', group: 'dither', label: '反向网点', type: 'boolean', default: false, visibleWhen: fam('halftone') },

  // 误差扩散
  {
    id: 'dither.ed.kernel',
    group: 'dither',
    label: '扩散核',
    type: 'select',
    default: 'floyd-steinberg',
    visibleWhen: fam('error-diffusion'),
    options: [
      opt('floyd-steinberg', 'Floyd–Steinberg'),
      opt('atkinson', 'Atkinson'),
      opt('jjn', 'Jarvis–Judice–Ninke'),
      opt('stucki', 'Stucki'),
      opt('burkes', 'Burkes'),
      opt('sierra3', 'Sierra（3 行）'),
      opt('sierra2', 'Sierra（2 行）'),
      opt('sierra-lite', 'Sierra Lite'),
      opt('stevenson-arce', 'Stevenson–Arce'),
      opt('false-fs', 'False Floyd–Steinberg'),
      opt('ostromoukhov', 'Ostromoukhov'),
      opt('zhou-fang', 'Zhou–Fang（变系数）'),
      opt('shiau-fan', 'Shiau–Fan'),
      opt('custom', '自定义核'),
    ],
  },
  { id: 'dither.ed.strength', group: 'dither', label: '误差强度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%', visibleWhen: fam('error-diffusion') },
  { id: 'dither.ed.serpentine', group: 'dither', label: '蛇形扫描', type: 'boolean', default: true, visibleWhen: fam('error-diffusion') },
  { id: 'dither.ed.clamp', group: 'dither', label: '误差截断', type: 'number', min: 1, max: 100, step: 1, default: 100, unit: '%', hint: '单个像素允许携带的最大误差，100 为不截断', visibleWhen: fam('error-diffusion') },
  {
    id: 'dither.ed.direction',
    group: 'dither',
    label: '扫描方向',
    type: 'select',
    default: 'ltr',
    visibleWhen: fam('error-diffusion'),
    options: [opt('ltr', '左 → 右'), opt('rtl', '右 → 左'), opt('ttb', '上 → 下'), opt('btt', '下 → 上')],
  },
  {
    id: 'dither.ed.custom',
    group: 'dither',
    label: '自定义核',
    type: 'text',
    multiline: true,
    default: 'X 7\n3 5 1',
    placeholder: 'X 标记当前像素，每行一排，末尾可写 /16 指定除数',
    visibleWhen: famAnd('error-diffusion', 'dither.ed.kernel', 'custom'),
  },
  { id: 'dither.ed.seed', group: 'dither', label: '随机种子', type: 'number', min: 0, max: 9999, step: 1, default: 1, visibleWhen: famAnd('error-diffusion', 'dither.ed.kernel', 'zhou-fang') },

  // 曲线扫描
  {
    id: 'dither.curve.type',
    group: 'dither',
    label: '曲线',
    type: 'select',
    default: 'hilbert',
    visibleWhen: fam('curve'),
    options: [opt('hilbert', 'Riemersma（Hilbert）'), opt('peano', 'Peano 曲线'), opt('gosper', 'Gosper 曲线'), opt('fass', 'FASS 曲线')],
  },
  { id: 'dither.curve.history', group: 'dither', label: '误差记忆', type: 'number', min: 1, max: 64, step: 1, default: 16, hint: 'Riemersma 参数：记住最近多少个像素的误差', visibleWhen: fam('curve') },
  { id: 'dither.curve.ratio', group: 'dither', label: '衰减比', type: 'number', min: 1, max: 64, step: 1, default: 16, hint: 'Riemersma 参数：最新误差与最旧误差的权重比', visibleWhen: fam('curve') },
  { id: 'dither.curve.strength', group: 'dither', label: '误差强度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%', visibleWhen: fam('curve') },

  // 点扩散 / DBS
  {
    id: 'dither.search.method',
    group: 'dither',
    label: '方法',
    type: 'select',
    default: 'knuth',
    visibleWhen: fam('search'),
    options: [opt('knuth', '点扩散（Knuth）'), opt('lippens', '点扩散（Lippens）'), opt('dbs', 'DBS（直接二值搜索）')],
  },
  { id: 'dither.search.strength', group: 'dither', label: '误差强度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%', visibleWhen: famAnd('search', 'dither.search.method', ['knuth', 'lippens']) },
  { id: 'dither.search.iterations', group: 'dither', label: '迭代次数', type: 'number', min: 1, max: 8, step: 1, default: 2, visibleWhen: famAnd('search', 'dither.search.method', 'dbs') },
  { id: 'dither.search.sigma', group: 'dither', label: '视觉模糊 σ', type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.5, unit: 'px', visibleWhen: famAnd('search', 'dither.search.method', 'dbs') },

  // 图案
  {
    id: 'dither.pattern.type',
    group: 'dither',
    label: '图案',
    type: 'select',
    default: 'checker',
    visibleWhen: fam('pattern'),
    options: [
      opt('checker', '棋盘'),
      opt('hlines', '横线'),
      opt('vlines', '竖线'),
      opt('diagonal', '斜线'),
      opt('cross', '交叉线'),
      opt('brick', '砖块'),
      opt('spiral', '螺旋'),
      opt('hexagon', '六边形'),
      opt('sine', '正弦波'),
    ],
  },
  { id: 'dither.pattern.scale', group: 'dither', label: '图案尺度', type: 'number', min: 2, max: 64, step: 1, default: 6, unit: 'px', visibleWhen: fam('pattern') },
  { id: 'dither.pattern.angle', group: 'dither', label: '图案角度', type: 'number', min: 0, max: 180, step: 1, default: 0, unit: '°', visibleWhen: fam('pattern') },

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

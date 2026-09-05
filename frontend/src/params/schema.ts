import type { ParamDef, ParamGroup, ParamOption, StyleKind } from './types';

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

export const STYLE_KINDS: ParamOption[] = [opt('dither', '抖动'), opt('hatch', '排线'), opt('halftone', '网点')];

/** 网点风格的形状（`halftone.shape`），与 `engine/halftone/shapes.ts` 的距离场一一对应 */
export const HALFTONE_SHAPES: ParamOption[] = [
  opt('circle', '圆形'),
  opt('square', '方形'),
  opt('roundsquare', '圆角方'),
  opt('diamond', '菱形'),
  opt('triangle', '三角'),
  opt('hexagon', '六边形'),
  opt('line', '线条'),
  opt('cross', '十字'),
];

/**
 * 只属于某一种风格的分组：风格切走后整组隐藏（`isParamVisible` 按这张表过滤），
 * 不用在每条记录上重复写条件。没列出的分组（画布、像素化、影调、特效）几种风格共用。
 */
export const GROUP_STYLE: Partial<Record<ParamGroup, StyleKind>> = {
  dither: 'dither',
  color: 'dither',
  grid: 'dither',
  hatch: 'hatch',
  halftone: 'halftone',
  screen: 'halftone',
  ink: 'halftone',
};

const onDither = { id: 'style.type', equals: 'dither' };
/** 网点风格自己按网格间距缩小画面，像素化的方法与偏移只有抖动与排线用 */
const notHalftone = { id: 'style.type', in: ['dither', 'hatch'] };
const fam = (family: string) => ({ id: 'dither.family', equals: family });
const bgOn = { id: 'tone.bg.enabled', equals: true };
const linkOn = { id: 'hatch.link', in: ['stroke', 'row', 'col', 'grid'] };
const famAnd = (family: string, id: string, value: string | string[]) => [
  fam(family),
  Array.isArray(value) ? { id, in: value } : { id, equals: value },
];

export const PARAM_SCHEMA: readonly ParamDef[] = [
  // ---------- 风格 ----------
  // 左栏页签「抖动 / 排线 / 网点」就是这个参数；它决定下面哪些分组露出来
  { id: 'style.type', group: 'style', label: '风格', type: 'select', default: 'dither', options: STYLE_KINDS },

  // ---------- 画布 ----------
  { id: 'canvas.width', group: 'canvas', label: '宽度', type: 'number', min: 16, max: 8192, step: 1, default: 1000, unit: 'px', advanced: true },
  { id: 'canvas.height', group: 'canvas', label: '高度', type: 'number', min: 16, max: 8192, step: 1, default: 600, unit: 'px', advanced: true },
  {
    id: 'canvas.fit',
    group: 'canvas',
    label: '适配',
    type: 'select',
    default: 'cover',
    advanced: true,
    options: [opt('contain', 'Contain'), opt('cover', 'Cover'), opt('fill', 'Fill'), opt('native', '原尺寸')],
  },

  // ---------- 像素化 ----------
  // 排线风格下格子大小由「横向 / 纵向间距」决定，像素尺寸只属于抖动
  { id: 'pixel.size', group: 'pixel', label: '像素尺寸', type: 'number', min: 1, max: 16, step: 1, default: 4, visibleWhen: onDither },
  {
    id: 'pixel.method',
    group: 'pixel',
    label: '降采样',
    type: 'select',
    default: 'box',
    visibleWhen: notHalftone,
    options: [opt('box', 'Box 平均'), opt('bilinear', '双线性'), opt('lanczos', 'Lanczos'), opt('nearest', '最近邻')],
  },
  { id: 'pixel.offsetX', group: 'pixel', label: '偏移 X', type: 'number', min: 0, max: 63, step: 1, default: 0, advanced: true, visibleWhen: notHalftone },
  { id: 'pixel.offsetY', group: 'pixel', label: '偏移 Y', type: 'number', min: 0, max: 63, step: 1, default: 0, advanced: true, visibleWhen: notHalftone },

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

  // 强制背景：把与画面边缘相连的干净背景换成一片规则的点，前景与高光原样保留
  { id: 'tone.bg.enabled', group: 'tone', label: '强制背景', type: 'boolean', default: false, hint: '把干净的背景换成一片规则的点，前景和高光原样保留' },
  { id: 'tone.bg.density', group: 'tone', label: '点密度', type: 'number', min: 0, max: 100, step: 1, default: 25, unit: '%', visibleWhen: bgOn },
  {
    id: 'tone.bg.polarity',
    group: 'tone',
    label: '点的明暗',
    type: 'select',
    default: 'auto',
    visibleWhen: bgOn,
    options: [opt('auto', '自动'), opt('light', '亮底暗点'), opt('dark', '暗底亮点')],
  },
  { id: 'tone.bg.strength', group: 'tone', label: '强度', type: 'number', min: 0, max: 100, step: 1, default: 100, unit: '%', visibleWhen: bgOn },
  { id: 'tone.bg.margin', group: 'tone', label: '边缘留白', type: 'number', min: 0, max: 8, step: 1, default: 0, unit: '格', visibleWhen: bgOn },
  {
    id: 'tone.bg.reference',
    group: 'tone',
    label: '背景色',
    type: 'select',
    default: 'auto',
    visibleWhen: bgOn,
    options: [opt('auto', '自动取边缘'), opt('manual', '手动指定')],
  },
  { id: 'tone.bg.color', group: 'tone', label: '指定背景色', type: 'color', default: '#FFFFFF', visibleWhen: [bgOn, { id: 'tone.bg.reference', equals: 'manual' }] },
  { id: 'tone.bg.tolerance', group: 'tone', label: '容差', type: 'number', min: 0, max: 100, step: 1, default: 30, unit: '%', visibleWhen: bgOn, advanced: true },
  { id: 'tone.bg.smooth', group: 'tone', label: '渐变容差', type: 'number', min: 0, max: 100, step: 1, default: 6, unit: '%', visibleWhen: bgOn, advanced: true },
  {
    id: 'tone.bg.scope',
    group: 'tone',
    label: '背景范围',
    type: 'select',
    default: 'connected',
    visibleWhen: bgOn,
    advanced: true,
    options: [opt('connected', '连通画面边缘'), opt('all', '全图同色')],
  },
  {
    id: 'tone.linear',
    group: 'tone',
    label: '线性空间',
    type: 'boolean',
    default: true,
    advanced: true,
    // 排线按"看起来多亮"定粗细，固定在 gamma 空间；抖动与网点（面积正比的墨量）都用得上
    visibleWhen: { id: 'style.type', in: ['dither', 'halftone'] },
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
  { id: 'dither.family', group: 'dither', label: '算法族', type: 'select', default: 'ordered', options: DITHER_FAMILIES },

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
    default: 'bayer2',
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

  // ---------- 网格渲染 ----------
  {
    id: 'grid.dot',
    group: 'grid',
    label: '网点',
    type: 'select',
    default: 'square',
    options: [opt('square', '方块'), opt('euclidean', '欧几里得网点'), opt('roundsquare', '圆方网点')],
  },
  { id: 'grid.invert', group: 'grid', label: '反向网点', type: 'boolean', default: false, hint: '背景改用墨色，网点画亮格子' },
  { id: 'grid.dotSize', group: 'grid', label: '网点大小', type: 'number', min: 10, max: 150, step: 1, default: 100, unit: '%', visibleWhen: { id: 'grid.dot', in: ['euclidean', 'roundsquare'] } },
  { id: 'grid.dotTone', group: 'grid', label: '随明暗缩放', type: 'boolean', default: false, visibleWhen: { id: 'grid.dot', in: ['euclidean', 'roundsquare'] } },
  { id: 'grid.metaball', group: 'grid', label: '点融合', type: 'boolean', default: false, hint: 'metaball：相邻网点粘连成 blob' },
  { id: 'grid.metaballRadius', group: 'grid', label: '融合半径', type: 'number', min: 50, max: 200, step: 1, default: 120, unit: '%', visibleWhen: { id: 'grid.metaball', equals: true } },
  { id: 'grid.gapX', group: 'grid', label: '横向间距', type: 'number', min: 0, max: 32, step: 1, default: 0, unit: 'px' },
  { id: 'grid.gapY', group: 'grid', label: '纵向间距', type: 'number', min: 0, max: 32, step: 1, default: 0, unit: 'px' },
  {
    id: 'grid.background',
    group: 'grid',
    label: '背景',
    type: 'select',
    default: 'none',
    options: [opt('none', '无'), opt('lines', '连线'), opt('dots', '网格点')],
  },
  {
    id: 'grid.lineDirection',
    group: 'grid',
    label: '线方向',
    type: 'select',
    default: 'row',
    visibleWhen: { id: 'grid.background', equals: 'lines' },
    options: [opt('row', '每行一根'), opt('col', '每列一根')],
  },
  { id: 'grid.lineWidth', group: 'grid', label: '线粗细', type: 'number', min: 1, max: 16, step: 1, default: 1, unit: 'px', visibleWhen: { id: 'grid.background', equals: 'lines' } },
  {
    id: 'grid.bgDotShape',
    group: 'grid',
    label: '图形',
    type: 'select',
    default: 'circle',
    visibleWhen: { id: 'grid.background', equals: 'dots' },
    options: [opt('circle', '圆'), opt('square', '方'), opt('diamond', '菱形'), opt('cross', '十字')],
  },
  { id: 'grid.bgDotSize', group: 'grid', label: '图形大小', type: 'number', min: 5, max: 100, step: 1, default: 30, unit: '%', visibleWhen: { id: 'grid.background', equals: 'dots' } },
  { id: 'grid.bgColor', group: 'grid', label: '背景色', type: 'color', default: '#888888', visibleWhen: { id: 'grid.background', in: ['lines', 'dots'] } },

  // ---------- 排线 ----------
  // 一个格子一笔：格子由横纵间距划分，每笔的粗细按格子明暗分成若干档，角度、长度、圆角全图一致。
  // 长度以「贯穿格子的那条弦」为 100%，粗细以「相邻平行线的间距」为 100%——100% 就是刚好连上 / 刚好挨上，换间距也不用重调。
  { id: 'hatch.angle', group: 'hatch', label: '角度', type: 'number', min: 0, max: 180, step: 1, default: 45, unit: '°' },
  { id: 'hatch.spacingX', group: 'hatch', label: '横向间距', type: 'number', min: 3, max: 128, step: 1, default: 14, unit: 'px' },
  { id: 'hatch.spacingY', group: 'hatch', label: '纵向间距', type: 'number', min: 3, max: 128, step: 1, default: 14, unit: 'px' },
  { id: 'hatch.levels', group: 'hatch', label: '色阶', type: 'number', min: 2, max: 16, step: 1, default: 6, hint: '明暗分成几档，每档一种粗细' },
  { id: 'hatch.length', group: 'hatch', label: '长度', type: 'number', min: 10, max: 200, step: 1, default: 80, unit: '%' },
  { id: 'hatch.maxWidth', group: 'hatch', label: '最粗', type: 'number', min: 5, max: 150, step: 1, default: 70, unit: '%' },
  { id: 'hatch.minWidth', group: 'hatch', label: '最细', type: 'number', min: 0, max: 100, step: 1, default: 8, unit: '%' },
  { id: 'hatch.roundness', group: 'hatch', label: '圆角', type: 'number', min: 0, max: 100, step: 1, default: 40, unit: '%' },
  { id: 'hatch.cross', group: 'hatch', label: '交叉排线', type: 'boolean', default: false, hint: '暗部再叠一层垂直方向的线' },
  { id: 'hatch.crossStart', group: 'hatch', label: '交叉起点', type: 'number', min: 0, max: 95, step: 1, default: 50, unit: '%', visibleWhen: { id: 'hatch.cross', equals: true } },
  { id: 'hatch.stagger', group: 'hatch', label: '错行', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%', advanced: true },
  {
    id: 'hatch.link',
    group: 'hatch',
    label: '连线',
    type: 'select',
    default: 'none',
    options: [opt('none', '无'), opt('stroke', '沿斜线'), opt('row', '横向'), opt('col', '纵向'), opt('grid', '横纵')],
  },
  { id: 'hatch.linkWidth', group: 'hatch', label: '连线粗细', type: 'number', min: 1, max: 16, step: 1, default: 1, unit: 'px', visibleWhen: linkOn },
  { id: 'hatch.linkColor', group: 'hatch', label: '连线颜色', type: 'color', default: '#9A9A9A', visibleWhen: linkOn },
  // 前景 / 背景在面板上归「颜色」一节（sections.ts 里按名单挪过去），数据上仍属排线分组，随预设一起露出
  { id: 'hatch.ink', group: 'hatch', label: '前景色', type: 'color', default: '#1C1C1C' },
  { id: 'hatch.paper', group: 'hatch', label: '背景色', type: 'color', default: '#D9D9D9' },

  // ---------- 网点：网点 ----------
  // 每个网格采样它盖住的那块画面的平均明暗，换成一颗点的大小；点是矢量形状，边缘抗锯齿。
  // 大小以「100% 刚好占满自己的格子」定义，换了间距也不用重调；形状跟着网格角度转。
  { id: 'halftone.shape', group: 'halftone', label: '网点形状', type: 'select', default: 'circle', options: HALFTONE_SHAPES },
  { id: 'halftone.size', group: 'halftone', label: '网点大小', type: 'number', min: 10, max: 150, step: 1, default: 100, unit: '%' },
  { id: 'halftone.minSize', group: 'halftone', label: '最小网点', type: 'number', min: 0, max: 100, step: 1, default: 10, unit: '%' },
  {
    id: 'halftone.mapping',
    group: 'halftone',
    label: '网点响应',
    type: 'select',
    default: 'area',
    options: [opt('area', '面积正比'), opt('linear', '直径正比')],
  },
  { id: 'halftone.gain', group: 'halftone', label: '网点增益', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: '%' },
  { id: 'halftone.stepped', group: 'halftone', label: '灰阶分级', type: 'boolean', default: false, hint: '把点的大小限定在固定几档' },
  { id: 'halftone.levels', group: 'halftone', label: '灰阶级数', type: 'number', min: 2, max: 32, step: 1, default: 6, visibleWhen: { id: 'halftone.stepped', equals: true } },
  { id: 'halftone.merge', group: 'halftone', label: '点融合', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%' },
  { id: 'halftone.antialias', group: 'halftone', label: '平滑边缘', type: 'boolean', default: true, advanced: true },

  // ---------- 网点：网格 ----------
  // 间距是相邻点的中心距，也是格子的宽 / 高；网格绕画布中心转，画布中心永远是一颗点的中心
  { id: 'screen.pitchX', group: 'screen', label: '横向间距', type: 'number', min: 3, max: 96, step: 1, default: 12, unit: 'px' },
  { id: 'screen.pitchY', group: 'screen', label: '纵向间距', type: 'number', min: 3, max: 96, step: 1, default: 12, unit: 'px' },
  { id: 'screen.angle', group: 'screen', label: '网格角度', type: 'number', min: 0, max: 180, step: 1, default: 0, unit: '°' },
  {
    id: 'screen.lattice',
    group: 'screen',
    label: '排列',
    type: 'select',
    default: 'square',
    options: [opt('square', '方格'), opt('hex', '交错')],
  },
  { id: 'screen.offsetX', group: 'screen', label: '偏移 X', type: 'number', min: 0, max: 63, step: 1, default: 0, unit: 'px', advanced: true },
  { id: 'screen.offsetY', group: 'screen', label: '偏移 Y', type: 'number', min: 0, max: 63, step: 1, default: 0, unit: 'px', advanced: true },

  // ---------- 网点：颜色 ----------
  // 面板上归「颜色」一节（sections.ts 里 color 节收 ink 分组），数据上是网点风格自己的分组
  {
    id: 'ink.mode',
    group: 'ink',
    label: '颜色模式',
    type: 'select',
    default: 'mono',
    options: [opt('mono', '双色'), opt('source', '原图色'), opt('cmyk', 'CMYK 分色')],
  },
  { id: 'ink.dot', group: 'ink', label: '网点颜色', type: 'color', default: '#11192D', visibleWhen: { id: 'ink.mode', equals: 'mono' } },
  { id: 'ink.paper', group: 'ink', label: '背景色', type: 'color', default: '#FFFFFF' },

  // ---------- 特效栈 ----------
  { id: 'effects.stack', group: 'effects', label: '特效栈', type: 'effects', default: '' },

  // ---------- 颜色 ----------
  {
    id: 'color.mode',
    group: 'color',
    label: '颜色模式',
    type: 'select',
    default: 'mono',
    options: [opt('mono', '单色'), opt('gray', '灰阶'), opt('tint', 'Tint'), opt('palette', 'Palette'), opt('channels', 'Channels')],
  },
  { id: 'color.levels', group: 'color', label: '灰阶级数', type: 'number', min: 2, max: 16, step: 1, default: 2, visibleWhen: { id: 'color.mode', in: ['gray', 'tint', 'channels'] } },
  // 单色 / 灰阶 / Tint 共用两端颜色：单色就是这两色，灰阶在两色之间等分，Tint 再在中间加站点
  { id: 'color.tint.dark', group: 'color', label: '暗色', type: 'color', default: '#000000', visibleWhen: { id: 'color.mode', in: ['mono', 'gray', 'tint'] } },
  { id: 'color.tint.light', group: 'color', label: '亮色', type: 'color', default: '#FFFFFF', visibleWhen: { id: 'color.mode', in: ['mono', 'gray', 'tint'] } },
  {
    id: 'color.tint.stops',
    group: 'color',
    label: '色带站点',
    type: 'text',
    default: '',
    placeholder: '可选的中间色，如 #FF6200 #004AB8',
    visibleWhen: { id: 'color.mode', equals: 'tint' },
    advanced: true,
  },
  {
    id: 'color.palette.preset',
    group: 'color',
    label: '调色板',
    type: 'select',
    default: 'gameboy',
    visibleWhen: { id: 'color.mode', equals: 'palette' },
    options: [
      opt('gameboy', 'Game Boy'),
      opt('gameboy-pocket', 'Game Boy Pocket'),
      opt('cga0', 'CGA 0'),
      opt('cga1', 'CGA 1'),
      opt('ega', 'EGA'),
      opt('c64', 'C64'),
      opt('zx', 'ZX Spectrum'),
      opt('nes', 'NES'),
      opt('pico8', 'PICO-8'),
      opt('db16', 'DB16'),
      opt('db32', 'DB32'),
      opt('apple2', 'Apple II'),
      opt('mac', 'Mac 1-bit'),
      opt('websafe', 'Web Safe'),
      opt('gray4', '灰阶 4'),
      opt('gray8', '灰阶 8'),
      opt('gray16', '灰阶 16'),
      opt('custom', '自定义'),
    ],
  },
  {
    id: 'color.palette.custom',
    group: 'color',
    label: '自定义色',
    type: 'text',
    default: '#11192D #7C889C #FF6200 #F9F9F9',
    placeholder: '#RRGGBB 列表，空格分隔',
    visibleWhen: [{ id: 'color.mode', equals: 'palette' }, { id: 'color.palette.preset', equals: 'custom' }],
    advanced: true,
  },
  {
    id: 'color.mismatch',
    group: 'color',
    label: '深度错配',
    type: 'boolean',
    default: false,
    hint: '先按 N 级亮度抖动，再按索引映射到调色板，N 与色数不同时产生 color glitch',
    visibleWhen: { id: 'color.mode', equals: 'palette' },
  },
  {
    id: 'color.palette.levels',
    group: 'color',
    label: '亮度级数 N',
    type: 'number',
    min: 2,
    max: 16,
    step: 1,
    default: 4,
    visibleWhen: [{ id: 'color.mode', equals: 'palette' }, { id: 'color.mismatch', equals: true }],
  },
  {
    id: 'color.channels.space',
    group: 'color',
    label: '通道',
    type: 'select',
    default: 'rgb',
    visibleWhen: { id: 'color.mode', equals: 'channels' },
    options: [opt('rgb', 'RGB'), opt('cmyk', 'CMYK')],
  },

  // Accent 强调色层
  { id: 'color.accent.enabled', group: 'color', label: '强调层', type: 'boolean', default: false },
  {
    id: 'color.accent.colors',
    group: 'color',
    label: '强调色',
    type: 'text',
    default: '#FF6200',
    placeholder: '1–6 色，可带权重：#FF6200:2 #004AB8',
    visibleWhen: { id: 'color.accent.enabled', equals: true },
  },
  { id: 'color.accent.density', group: 'color', label: '密度', type: 'number', min: 0, max: 100, step: 1, default: 10, unit: '%', visibleWhen: { id: 'color.accent.enabled', equals: true } },
  {
    id: 'color.accent.placement',
    group: 'color',
    label: '放置规则',
    type: 'select',
    default: 'random',
    visibleWhen: { id: 'color.accent.enabled', equals: true },
    options: [opt('random', '随机'), opt('bluenoise', '蓝噪声'), opt('level', '仅某灰阶档'), opt('overflow', '误差溢出'), opt('edge', '边缘')],
  },
  {
    id: 'color.accent.level',
    group: 'color',
    label: '灰阶档',
    type: 'number',
    min: 0,
    max: 15,
    step: 1,
    default: 0,
    visibleWhen: [{ id: 'color.accent.enabled', equals: true }, { id: 'color.accent.placement', equals: 'level' }],
  },
  {
    id: 'color.accent.target',
    group: 'color',
    label: '目标范围',
    type: 'select',
    default: 'foreground',
    visibleWhen: { id: 'color.accent.enabled', equals: true },
    options: [opt('foreground', '仅前景'), opt('background', '仅背景'), opt('all', '全部')],
  },
  { id: 'color.accent.spacing', group: 'color', label: '最小间距', type: 'number', min: 0, max: 8, step: 1, default: 0, visibleWhen: { id: 'color.accent.enabled', equals: true } },
  { id: 'color.accent.chain', group: 'color', label: '连锁概率', type: 'number', min: 0, max: 100, step: 1, default: 0, unit: '%', visibleWhen: { id: 'color.accent.enabled', equals: true } },
  { id: 'color.accent.seed', group: 'color', label: '种子', type: 'number', min: 0, max: 9999, step: 1, default: 1, visibleWhen: { id: 'color.accent.enabled', equals: true } },
];

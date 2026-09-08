import { hash2 } from '../util/random';
import { ROUND_SQUARE_CORNER, shapeDistance } from './shapes';

/**
 * 符号库：「符号」风格（`style.type = glyph`）每个格子里画的图元。
 * 格子里画的不是同一种形状的放大缩小，而是按明暗从一串符号里挑一个——亮处是小点、中间调是斜线、暗处是十字与网格，
 * 像手绘的图例或打字机敲出来的字符画。
 * 每个符号由几条基本图元拼成（实心圆、圆圈、线段、三角、方、圆角框、菱、六边、多边形），图元只有两种尺寸参照：
 * `r` 是这一格的符号半径（随灰阶变化），"跨格"线段则以半格为单位、两头各多出半像素，让相邻格子的线连成一条。
 * 所有图元都给出有符号距离，渲染与融合沿用网点那一套；SVG 导出用同一张表出 <circle> / <line> / <polygon>。
 */

export type GlyphId =
  // 点
  | 'blank'
  | 'pip'
  | 'dot'
  | 'colon'
  | 'quad'
  | 'ring'
  | 'ringdot'
  | 'rings'
  | 'clover'
  | 'flower'
  | 'ringpair'
  | 'ringtiny'
  | 'rings3'
  | 'ringthick'
  | 'ringorb'
  // 线
  | 'tick'
  | 'minus'
  | 'dash'
  | 'bar'
  | 'slash'
  | 'backslash'
  | 'equals'
  | 'pipes'
  | 'plus'
  | 'x'
  | 'asterisk'
  | 'star8'
  | 'hash'
  | 'hashx'
  | 'dotslash'
  | 'slashshort'
  | 'xmark'
  | 'zigzag'
  | 'stripes'
  | 'slabthin'
  | 'slab'
  | 'slabwide'
  | 'comb'
  | 'grillehair'
  | 'grillefine'
  | 'grillemid'
  | 'grillebold'
  | 'grillefull'
  // 几何
  | 'tri'
  | 'triline'
  | 'tridown'
  | 'square'
  | 'squareline'
  | 'diamond'
  | 'diamondline'
  | 'hex'
  | 'boxx'
  | 'boxplus'
  | 'circlex'
  | 'circleplus'
  | 'roundbox'
  | 'boxdot'
  | 'hexline'
  | 'checker'
  | 'rook'
  | 'blockhole'
  | 'blockhalf'
  | 'block'
  // 字符
  | 'one'
  | 'four'
  | 'six'
  | 'seven'
  | 'eight'
  | 'oslash'
  | 'percent'
  | 'tee'
  | 'el'
  | 'vee'
  | 'zed'
  | 'en'
  | 'em'
  | 'aitch'
  | 'ee'
  | 'wye'
  | 'ay'
  | 'see'
  | 'dee'
  | 'gee'
  | 'jay'
  | 'kay'
  | 'ar'
  | 'ess'
  | 'you'
  | 'dubya'
  | 'comma'
  | 'semicolon'
  | 'underscore'
  | 'bracket';

/** 符号的分类，符号选择器按它分组 */
export type GlyphGroup = 'dots' | 'lines' | 'geometry' | 'chars';

export interface GlyphInfo {
  id: GlyphId;
  label: string;
  group: GlyphGroup;
  /** 一句话：长什么样，解读浮层与选择器的提示用 */
  desc: string;
}

/** 符号表的顺序就是格子里存的编码；0 是「空」，不画。老的 16 个排在最前，编码不变 */
export const GLYPHS: readonly GlyphInfo[] = [
  { id: 'blank', label: '空', group: 'dots', desc: '什么都不画，留出纸色' },
  { id: 'dot', label: '圆点', group: 'dots', desc: '实心圆，占满符号大小' },
  { id: 'ring', label: '圆圈', group: 'dots', desc: '空心圆，只有一圈线' },
  { id: 'dash', label: '横线', group: 'lines', desc: '贯穿格子的横线，与左右邻格连成一条' },
  { id: 'bar', label: '竖线', group: 'lines', desc: '贯穿格子的竖线，与上下邻格连成一条' },
  { id: 'slash', label: '斜线', group: 'lines', desc: '左下到右上贯穿格子，邻格接成长斜线' },
  { id: 'backslash', label: '反斜线', group: 'lines', desc: '左上到右下贯穿格子，邻格接成长斜线' },
  { id: 'x', label: '叉', group: 'lines', desc: '两条贯穿格子的斜线交叉' },
  { id: 'plus', label: '十字', group: 'lines', desc: '格子里的横竖两笔，不出格' },
  { id: 'hash', label: '网格', group: 'lines', desc: '贯穿的横线加竖线，邻格连成网' },
  { id: 'tri', label: '实心三角', group: 'geometry', desc: '尖朝上的实心三角' },
  { id: 'triline', label: '三角框', group: 'geometry', desc: '尖朝上的空心三角' },
  { id: 'four', label: '4', group: 'chars', desc: '打字机的数字 4' },
  { id: 'six', label: '6', group: 'chars', desc: '打字机的数字 6' },
  { id: 'percent', label: '%', group: 'chars', desc: '两个小圈夹一道斜线' },
  { id: 'dotslash', label: '点线', group: 'lines', desc: '实心圆叠在贯穿的斜线上' },
  { id: 'pip', label: '小点', group: 'dots', desc: '不到一半大的实心小圆' },
  { id: 'colon', label: '双点', group: 'dots', desc: '上下两个小圆，像冒号' },
  { id: 'quad', label: '四点', group: 'dots', desc: '四角各一个小圆' },
  { id: 'ringdot', label: '靶心', group: 'dots', desc: '圆圈中间加一个小实心圆' },
  { id: 'tick', label: '短竖', group: 'lines', desc: '格子中间一小段竖线' },
  { id: 'minus', label: '短横', group: 'lines', desc: '格子里的一横，不出格' },
  { id: 'equals', label: '双横', group: 'lines', desc: '上下两道短横，像等号' },
  { id: 'pipes', label: '双竖', group: 'lines', desc: '左右两道短竖' },
  { id: 'asterisk', label: '星号', group: 'lines', desc: '三笔穿过中心，六个芒' },
  { id: 'star8', label: '八芒', group: 'lines', desc: '横竖斜四笔穿过中心' },
  { id: 'hashx', label: '密网', group: 'lines', desc: '横竖斜反斜四条贯穿线，最密' },
  { id: 'tridown', label: '倒三角', group: 'geometry', desc: '尖朝下的实心三角' },
  { id: 'square', label: '实心方', group: 'geometry', desc: '实心方块' },
  { id: 'squareline', label: '方框', group: 'geometry', desc: '空心方块' },
  { id: 'diamond', label: '实心菱', group: 'geometry', desc: '实心菱形' },
  { id: 'diamondline', label: '菱框', group: 'geometry', desc: '空心菱形' },
  { id: 'hex', label: '六边形', group: 'geometry', desc: '实心正六边形' },
  { id: 'boxx', label: '叉框', group: 'geometry', desc: '方框里打一个叉' },
  { id: 'boxplus', label: '田', group: 'geometry', desc: '方框里加一个十字' },
  { id: 'circlex', label: '圈叉', group: 'geometry', desc: '圆圈里打一个叉' },
  { id: 'circleplus', label: '圈十', group: 'geometry', desc: '圆圈里加一个十字' },
  { id: 'one', label: '1', group: 'chars', desc: '打字机的数字 1' },
  { id: 'seven', label: '7', group: 'chars', desc: '打字机的数字 7' },
  { id: 'eight', label: '8', group: 'chars', desc: '上下两个圈叠成 8' },
  { id: 'oslash', label: 'Ø', group: 'chars', desc: '圆圈加一道斜线' },
  { id: 'tee', label: 'T', group: 'chars', desc: '字母 T' },
  { id: 'el', label: 'L', group: 'chars', desc: '字母 L' },
  { id: 'vee', label: 'V', group: 'chars', desc: '字母 V' },
  { id: 'zed', label: 'Z', group: 'chars', desc: '字母 Z' },
  { id: 'en', label: 'N', group: 'chars', desc: '字母 N' },
  { id: 'em', label: 'M', group: 'chars', desc: '字母 M' },
  { id: 'aitch', label: 'H', group: 'chars', desc: '字母 H' },
  { id: 'ee', label: 'E', group: 'chars', desc: '字母 E' },
  { id: 'wye', label: 'Y', group: 'chars', desc: '字母 Y' },
  // 荧光电路（参考图一：黑底荧光绿的 · 、+ × ◎ ▢ ✤ ⬡）
  { id: 'slashshort', label: '短斜线', group: 'lines', desc: '格子里一小段斜线，不出格、不与邻格相连' },
  { id: 'xmark', label: '叉号', group: 'lines', desc: '格子里的一个小叉，不出格' },
  { id: 'rings', label: '双圈', group: 'dots', desc: '大圈套小圈的同心圆' },
  { id: 'clover', label: '四叶', group: 'dots', desc: '四个圆叠成的四叶草' },
  { id: 'roundbox', label: '圆角框', group: 'geometry', desc: '空心的圆角方块' },
  { id: 'boxdot', label: '框点', group: 'geometry', desc: '圆角方框中间一个实心点' },
  { id: 'hexline', label: '六边框', group: 'geometry', desc: '空心正六边形' },
  // 棋盘（参考图二：墨绿底上薄荷绿与淡紫的棋盘格、花、折线、竖纹、城堡）
  { id: 'flower', label: '花', group: 'dots', desc: '六瓣小花，花心留空' },
  { id: 'zigzag', label: '折线', group: 'lines', desc: '贯穿格子的 < 形折线，上下邻格接成一条锯齿' },
  { id: 'stripes', label: '竖纹', group: 'lines', desc: '三道贯穿格子的细竖线，邻格接成密条纹' },
  { id: 'checker', label: '棋盘', group: 'geometry', desc: '对角的两个实心方块，邻格拼成棋盘格' },
  { id: 'rook', label: '城堡', group: 'geometry', desc: '平底方块顶上开一个豁口，像棋盘上的车' },
  // 失步（参考图：白纸上的横向扫描线与黑色像素块）——粗细分档的横条与被冲掉一块的实心方
  { id: 'slabthin', label: '细板', group: 'lines', desc: '贯穿格子的细横条，比横线粗一点，邻格接成一条' },
  { id: 'slab', label: '横板', group: 'lines', desc: '贯穿格子的横条，占格高约四成，邻格接成一条粗线' },
  { id: 'slabwide', label: '厚板', group: 'lines', desc: '贯穿格子的厚横条，上下各留一线缝，成片时是带白缝的黑带' },
  { id: 'blockhole', label: '穿孔块', group: 'geometry', desc: '实心方块中间冲掉一个小方孔，孔里露出纸色' },
  { id: 'blockhalf', label: '半块', group: 'geometry', desc: '实心方块的下半截，与邻格拼出半格高的台阶' },
  // 丝网海报（米白纸上黑色的叠圈与短竖纹打底，绿圆点与橙三角点缀）
  { id: 'comb', label: '短竖纹', group: 'lines', desc: '三道不出格的短竖线，上下邻格之间留缝，连成一片短竖笔触' },
  { id: 'ringpair', label: '叠圈', group: 'dots', desc: '两个左右错开的圆圈，像交叠的两个环' },
  // 竖栅（参考图：黑底上的假彩色扫描图，整幅盖着一层等距竖线栅，越亮的地方栅线越粗）
  { id: 'grillehair', label: '竖栅·微', group: 'lines', desc: '三道贯穿格子的实心细竖线，与竖纹同一个栅距，邻格接成等距竖栅' },
  { id: 'grillefine', label: '竖栅·细', group: 'lines', desc: '三道贯穿格子的实心竖带，比「微」粗一档，栅距不变' },
  { id: 'grillemid', label: '竖栅·中', group: 'lines', desc: '三道贯穿格子的实心竖带，比「细」粗一档，栅距不变' },
  { id: 'grillebold', label: '竖栅·粗', group: 'lines', desc: '三道贯穿格子的实心粗竖带，缝比带窄，栅距不变' },
  { id: 'grillefull', label: '竖栅·满', group: 'lines', desc: '三道贯穿格子的实心宽竖带，只剩三道细缝，栅距不变' },
  { id: 'block', label: '实心格', group: 'geometry', desc: '填满整格的实心块，邻格拼成一整片，不留缝' },
  { id: 'ringtiny', label: '小圈', group: 'dots', desc: '不到一半大的空心小圆，比圆圈轻一档' },
  { id: 'rings3', label: '三环', group: 'dots', desc: '三个同心圆一圈套一圈，圈与圈之间留等宽的缝' },
  { id: 'ringorb', label: '环心球', group: 'dots', desc: '粗圆环中间悬一个实心圆，环与球之间留一圈纸色' },
  { id: 'ringthick', label: '粗圈', group: 'dots', desc: '加粗的圆环，中间只剩一个小孔；带宽按符号半径算，不跟线粗走' },
  // 终端字符画（参考图：黑底上青绿两色的一屏字）：补一批等宽字母与标点，凑齐屏幕上敲得出来的字符
  { id: 'ay', label: 'A', group: 'chars', desc: '字母 A' },
  { id: 'see', label: 'C', group: 'chars', desc: '字母 C' },
  { id: 'dee', label: 'D', group: 'chars', desc: '字母 D' },
  { id: 'gee', label: 'G', group: 'chars', desc: '字母 G' },
  { id: 'jay', label: 'J', group: 'chars', desc: '字母 J' },
  { id: 'kay', label: 'K', group: 'chars', desc: '字母 K' },
  { id: 'ar', label: 'R', group: 'chars', desc: '字母 R' },
  { id: 'ess', label: 'S', group: 'chars', desc: '字母 S' },
  { id: 'you', label: 'U', group: 'chars', desc: '字母 U' },
  { id: 'dubya', label: 'W', group: 'chars', desc: '字母 W' },
  { id: 'comma', label: '逗号', group: 'chars', desc: '格子左下角的一小撇' },
  { id: 'semicolon', label: '分号', group: 'chars', desc: '一个点加一小撇' },
  { id: 'underscore', label: '下划线', group: 'chars', desc: '贴着格子底边的横线，与左右邻格连成一条' },
  { id: 'bracket', label: '方括号', group: 'chars', desc: '一个方括号 [' },
];

export const GLYPH_IDS: readonly GlyphId[] = GLYPHS.map((g) => g.id);

export const GLYPH_CODE: Readonly<Record<GlyphId, number>> = Object.fromEntries(GLYPH_IDS.map((id, k) => [id, k])) as Record<GlyphId, number>;

const infoById = new Map(GLYPHS.map((g) => [g.id, g]));

export function glyphInfo(id: GlyphId): GlyphInfo {
  return infoById.get(id)!;
}

export function isGlyphId(v: unknown): v is GlyphId {
  return typeof v === 'string' && infoById.has(v as GlyphId);
}

export const GLYPH_GROUPS: ReadonlyArray<{ id: GlyphGroup; label: string }> = [
  { id: 'dots', label: '点' },
  { id: 'lines', label: '线' },
  { id: 'geometry', label: '几何' },
  { id: 'chars', label: '字符' },
];

/**
 * 图元。坐标单位：`c` / `o` / `s` / `q` / `Q` / `b` / `R` / `d` / `D` / `P` 以符号半径 r 为 1（格子 100% 时 r 是半格）；
 * `S` 是跨格线段，以半格为 1，两头各多出半像素盖住格间接缝。
 * 三角用网点形状里那个等边三角（`t` 实心、`T` 描边、`v` 尖朝下），`g` 是实心六边形、`G` 是六边框；
 * `b` 是挪开中心的实心方（棋盘格用），`r` 是挪开中心的实心矩形（半宽 w、半高 h 分开给，横板与穿孔块用），
 * `R` 是圆角方框，`P` 是任意实心多边形（顶点按顺序给）；
 * `V` 是跨格竖带：上下贯穿整格，中心与半宽都以半格为 1，粗细不随符号大小与线粗变。
 */
type Prim =
  | { k: 'c'; x: number; y: number; r: number }
  | { k: 'o'; x: number; y: number; r: number }
  | { k: 's'; x1: number; y1: number; x2: number; y2: number }
  | { k: 'S'; x1: number; y1: number; x2: number; y2: number }
  | { k: 't' }
  | { k: 'T' }
  | { k: 'v' }
  | { k: 'q'; h: number }
  | { k: 'Q'; h: number }
  | { k: 'b'; x: number; y: number; h: number }
  | { k: 'r'; x: number; y: number; w: number; h: number }
  | { k: 'R'; h: number }
  | { k: 'd' }
  | { k: 'D' }
  | { k: 'g' }
  | { k: 'G' }
  | { k: 'V'; x: number; w: number }
  | { k: 'O'; r: number; w: number }
  | { k: 'P'; pts: ReadonlyArray<readonly [number, number]> };

const SLASH: Prim = { k: 'S', x1: -1, y1: 1, x2: 1, y2: -1 };
const BACKSLASH: Prim = { k: 'S', x1: -1, y1: -1, x2: 1, y2: 1 };
const DASH: Prim = { k: 'S', x1: -1, y1: 0, x2: 1, y2: 0 };
const BAR: Prim = { k: 'S', x1: 0, y1: -1, x2: 0, y2: 1 };
const H: Prim = { k: 's', x1: -1, y1: 0, x2: 1, y2: 0 };
const V: Prim = { k: 's', x1: 0, y1: -1, x2: 0, y2: 1 };
const DIAG: Prim = { k: 's', x1: -0.85, y1: 0.85, x2: 0.85, y2: -0.85 };
const ANTI: Prim = { k: 's', x1: -0.85, y1: -0.85, x2: 0.85, y2: 0.85 };
/** 方框的半边：留一点缝，相邻格子的方块不粘连 */
const BOX = 0.85;
const seg = (x1: number, y1: number, x2: number, y2: number): Prim => ({ k: 's', x1, y1, x2, y2 });
/** 竖栅：三道贯穿格子的实心竖带，中心在 0 与 ±2/3 半格，半宽 w 半格——带宽正好是格宽的 w，缝也等宽 */
const grille = (w: number): readonly Prim[] => [
  { k: 'V', x: -2 / 3, w },
  { k: 'V', x: 0, w },
  { k: 'V', x: 2 / 3, w },
];
/** 六瓣花：花瓣中心在半径 0.62 的圆周上、花瓣半径 0.36，相邻花瓣略叠，花心留一个小孔 */
const FLOWER: readonly Prim[] = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 3) * k + Math.PI / 6;
  return { k: 'c', x: 0.62 * Math.cos(a), y: 0.62 * Math.sin(a), r: 0.36 } as const;
});

/** 贯穿格子的横条：半宽取满一个符号半径，邻格之间接得上；半高 h 决定这一档有多粗 */
const slab = (h: number): Prim => ({ k: 'r', x: 0, y: 0, w: 1, h });
/** 穿孔块：BOX 见方的实心块中间留一个半边为 g 的方孔，四条边各是一个矩形，孔里露出纸色 */
const holed = (g: number): readonly Prim[] => {
  const t = (BOX - g) / 2;
  const m = (BOX + g) / 2;
  return [
    { k: 'r', x: 0, y: -m, w: BOX, h: t },
    { k: 'r', x: 0, y: m, w: BOX, h: t },
    { k: 'r', x: -m, y: 0, w: t, h: g },
    { k: 'r', x: m, y: 0, w: t, h: g },
  ];
};

const GLYPH_PRIMS: Readonly<Record<GlyphId, readonly Prim[]>> = {
  blank: [],
  dot: [{ k: 'c', x: 0, y: 0, r: 1 }],
  ring: [{ k: 'o', x: 0, y: 0, r: 1 }],
  dash: [DASH],
  bar: [BAR],
  slash: [SLASH],
  backslash: [BACKSLASH],
  x: [SLASH, BACKSLASH],
  plus: [H, V],
  hash: [DASH, BAR],
  tri: [{ k: 't' }],
  triline: [{ k: 'T' }],
  // 打字机的 4：斜笔、横笔、竖笔
  four: [seg(0.3, -1, -0.75, 0.35), seg(-0.75, 0.35, 0.8, 0.35), seg(0.3, -1, 0.3, 1)],
  // 6：下面一个圈，左侧一笔往右上挑
  six: [{ k: 'o', x: 0, y: 0.4, r: 0.6 }, seg(-0.55, 0.2, 0.45, -1)],
  // %：两个小圈夹一条斜线
  percent: [
    { k: 'o', x: -0.55, y: -0.55, r: 0.4 },
    { k: 'o', x: 0.55, y: 0.55, r: 0.4 },
    seg(0.6, -1, -0.6, 1),
  ],
  dotslash: [{ k: 'c', x: 0, y: 0, r: 1 }, SLASH],
  pip: [{ k: 'c', x: 0, y: 0, r: 0.45 }],
  colon: [
    { k: 'c', x: 0, y: -0.55, r: 0.38 },
    { k: 'c', x: 0, y: 0.55, r: 0.38 },
  ],
  quad: [
    { k: 'c', x: -0.55, y: -0.55, r: 0.32 },
    { k: 'c', x: 0.55, y: -0.55, r: 0.32 },
    { k: 'c', x: -0.55, y: 0.55, r: 0.32 },
    { k: 'c', x: 0.55, y: 0.55, r: 0.32 },
  ],
  ringdot: [
    { k: 'o', x: 0, y: 0, r: 1 },
    { k: 'c', x: 0, y: 0, r: 0.38 },
  ],
  tick: [seg(0, -0.5, 0, 0.5)],
  minus: [H],
  equals: [seg(-1, -0.45, 1, -0.45), seg(-1, 0.45, 1, 0.45)],
  pipes: [seg(-0.45, -1, -0.45, 1), seg(0.45, -1, 0.45, 1)],
  // 星号：三笔过中心，六个芒
  asterisk: [V, seg(-0.866, -0.5, 0.866, 0.5), seg(-0.866, 0.5, 0.866, -0.5)],
  star8: [H, V, DIAG, ANTI],
  hashx: [DASH, BAR, SLASH, BACKSLASH],
  tridown: [{ k: 'v' }],
  square: [{ k: 'q', h: BOX }],
  squareline: [{ k: 'Q', h: BOX }],
  diamond: [{ k: 'd' }],
  diamondline: [{ k: 'D' }],
  hex: [{ k: 'g' }],
  boxx: [{ k: 'Q', h: BOX }, seg(-BOX, -BOX, BOX, BOX), seg(-BOX, BOX, BOX, -BOX)],
  boxplus: [{ k: 'Q', h: BOX }, seg(-BOX, 0, BOX, 0), seg(0, -BOX, 0, BOX)],
  circlex: [{ k: 'o', x: 0, y: 0, r: 1 }, seg(-0.62, -0.62, 0.62, 0.62), seg(-0.62, 0.62, 0.62, -0.62)],
  circleplus: [{ k: 'o', x: 0, y: 0, r: 1 }, seg(-0.85, 0, 0.85, 0), seg(0, -0.85, 0, 0.85)],
  one: [seg(0, -1, 0, 1), seg(0, -1, -0.5, -0.55)],
  seven: [seg(-0.7, -1, 0.7, -1), seg(0.7, -1, -0.15, 1)],
  eight: [
    { k: 'o', x: 0, y: -0.45, r: 0.55 },
    { k: 'o', x: 0, y: 0.45, r: 0.55 },
  ],
  oslash: [{ k: 'o', x: 0, y: 0, r: 1 }, seg(-0.55, 0.9, 0.55, -0.9)],
  tee: [seg(-0.8, -1, 0.8, -1), seg(0, -1, 0, 1)],
  el: [seg(-0.6, -1, -0.6, 1), seg(-0.6, 1, 0.7, 1)],
  vee: [seg(-0.8, -1, 0, 1), seg(0, 1, 0.8, -1)],
  zed: [seg(-0.8, -1, 0.8, -1), seg(0.8, -1, -0.8, 1), seg(-0.8, 1, 0.8, 1)],
  en: [seg(-0.7, 1, -0.7, -1), seg(-0.7, -1, 0.7, 1), seg(0.7, 1, 0.7, -1)],
  em: [seg(-0.8, 1, -0.8, -1), seg(-0.8, -1, 0, 0.2), seg(0, 0.2, 0.8, -1), seg(0.8, -1, 0.8, 1)],
  aitch: [seg(-0.7, -1, -0.7, 1), seg(0.7, -1, 0.7, 1), seg(-0.7, 0, 0.7, 0)],
  ee: [seg(-0.7, -1, -0.7, 1), seg(-0.7, -1, 0.7, -1), seg(-0.7, 0, 0.5, 0), seg(-0.7, 1, 0.7, 1)],
  wye: [seg(-0.8, -1, 0, 0), seg(0.8, -1, 0, 0), seg(0, 0, 0, 1)],
  // 等宽字母：与已有的 T / L / V / Z / N / M / H / E / Y 一样用直线段拼，像点阵字库里的字形
  ay: [seg(-0.75, 1, 0, -1), seg(0, -1, 0.75, 1), seg(-0.42, 0.15, 0.42, 0.15)],
  see: [seg(0.7, -1, -0.3, -1), seg(-0.3, -1, -0.72, -0.55), seg(-0.72, -0.55, -0.72, 0.55), seg(-0.72, 0.55, -0.3, 1), seg(-0.3, 1, 0.7, 1)],
  dee: [seg(-0.7, -1, -0.7, 1), seg(-0.7, -1, 0.2, -1), seg(0.2, -1, 0.7, -0.5), seg(0.7, -0.5, 0.7, 0.5), seg(0.7, 0.5, 0.2, 1), seg(0.2, 1, -0.7, 1)],
  gee: [seg(0.7, -1, -0.3, -1), seg(-0.3, -1, -0.72, -0.55), seg(-0.72, -0.55, -0.72, 0.55), seg(-0.72, 0.55, -0.3, 1), seg(-0.3, 1, 0.7, 1), seg(0.7, 1, 0.7, 0.1), seg(0.7, 0.1, 0.1, 0.1)],
  jay: [seg(0.35, -1, 0.35, 0.6), seg(0.35, 0.6, -0.05, 1), seg(-0.05, 1, -0.55, 0.72)],
  kay: [seg(-0.7, -1, -0.7, 1), seg(0.72, -1, -0.7, 0.1), seg(-0.7, 0.1, 0.72, 1)],
  ar: [seg(-0.7, -1, -0.7, 1), seg(-0.7, -1, 0.35, -1), seg(0.35, -1, 0.68, -0.6), seg(0.68, -0.6, 0.35, -0.15), seg(0.35, -0.15, -0.7, -0.15), seg(0.05, -0.15, 0.72, 1)],
  ess: [seg(0.7, -1, -0.7, -1), seg(-0.7, -1, -0.7, 0), seg(-0.7, 0, 0.7, 0), seg(0.7, 0, 0.7, 1), seg(0.7, 1, -0.7, 1)],
  you: [seg(-0.7, -1, -0.7, 0.6), seg(-0.7, 0.6, -0.3, 1), seg(-0.3, 1, 0.3, 1), seg(0.3, 1, 0.7, 0.6), seg(0.7, 0.6, 0.7, -1)],
  dubya: [seg(-0.85, -1, -0.5, 1), seg(-0.5, 1, 0, -0.25), seg(0, -0.25, 0.5, 1), seg(0.5, 1, 0.85, -1)],
  comma: [seg(0.12, 0.5, -0.15, 1)],
  semicolon: [{ k: 'c', x: 0, y: -0.35, r: 0.3 }, seg(0.12, 0.5, -0.15, 1)],
  // 下划线贴着格子底边，与左右邻格连成一条
  underscore: [{ k: 'S', x1: -1, y1: 0.78, x2: 1, y2: 0.78 }],
  bracket: [seg(0.35, -1, -0.3, -1), seg(-0.3, -1, -0.3, 1), seg(-0.3, 1, 0.35, 1)],
  // 荧光电路：短斜线与叉号都不出格，邻格之间断开
  slashshort: [DIAG],
  xmark: [DIAG, ANTI],
  rings: [
    { k: 'o', x: 0, y: 0, r: 1 },
    { k: 'o', x: 0, y: 0, r: 0.5 },
  ],
  // 四叶草：四个圆两两相切多一点，中间只留一个小孔
  clover: [
    { k: 'c', x: -0.47, y: -0.47, r: 0.53 },
    { k: 'c', x: 0.47, y: -0.47, r: 0.53 },
    { k: 'c', x: -0.47, y: 0.47, r: 0.53 },
    { k: 'c', x: 0.47, y: 0.47, r: 0.53 },
  ],
  roundbox: [{ k: 'R', h: BOX }],
  boxdot: [
    { k: 'R', h: BOX },
    { k: 'c', x: 0, y: 0, r: 0.3 },
  ],
  hexline: [{ k: 'G' }],
  // 棋盘：六瓣花绕着花心一圈，相邻花瓣略叠
  flower: FLOWER,
  // 折线：右上 → 左中 → 右下，两头都落在右边格线上，上下邻格接成一条锯齿
  zigzag: [
    { k: 'S', x1: 1, y1: -1, x2: -1, y2: 0 },
    { k: 'S', x1: -1, y1: 0, x2: 1, y2: 1 },
  ],
  // 竖纹：三道等距的贯穿竖线，间距是格宽的三分之二，邻格接上后整片等距
  stripes: [
    { k: 'S', x1: -2 / 3, y1: -1, x2: -2 / 3, y2: 1 },
    BAR,
    { k: 'S', x1: 2 / 3, y1: -1, x2: 2 / 3, y2: 1 },
  ],
  // 棋盘格：左上与右下两个象限实心，100% 大小时正好与邻格拼成棋盘
  checker: [
    { k: 'b', x: -0.5, y: -0.5, h: 0.5 },
    { k: 'b', x: 0.5, y: 0.5, h: 0.5 },
  ],
  // 竖栅一家：与竖纹同一个栅距（三道，中心在 0 与 ±2/3 半格，也就是每格宽的三分之一一道），
  // 只是带子越来越粗——微 15% → 细 33% → 中 51% → 粗 69% → 满 87%，五档等差，缝始终等宽，
  // 整幅画面接成一片栅距不变、只有粗细在变的竖栅，像显像管的荫罩栅。
  // 用跨格竖带 `V` 而不是线段：粗细写死在符号里，不跟「线粗」「符号大小」走，颜色才不会被抗锯齿冲淡。
  grillehair: grille(0.05),
  grillefine: grille(0.11),
  grillemid: grille(0.17),
  grillebold: grille(0.23),
  grillefull: grille(0.29),
  // 实心格：竖带铺满整格（半宽就是半格再多半像素），邻格拼成一整片
  block: [{ k: 'V', x: 0, w: 1 }],
  // 圆环一家：小圈补在小点与圆圈之间；三环、环心球、粗圈把暗部撑起来——
  // 同一个圆形骨架从一粒点长到几乎填满格子的粗环，墨量一路递增，成片时是一张圆形的密文
  ringtiny: [{ k: 'o', x: 0, y: 0, r: 0.62 }],
  rings3: [
    { k: 'o', x: 0, y: 0, r: 1 },
    { k: 'o', x: 0, y: 0, r: 0.62 },
    { k: 'o', x: 0, y: 0, r: 0.26 },
  ],
  ringorb: [
    { k: 'O', r: 1, w: 0.2 },
    { k: 'c', x: 0, y: 0, r: 0.45 },
  ],
  ringthick: [{ k: 'O', r: 1, w: 0.36 }],
  // 城堡：平底、直边，顶上中间开一个豁口分成两个齿
  rook: [
    {
      k: 'P',
      pts: [
        [-0.8, 0.95],
        [-0.8, -0.95],
        [-0.3, -0.95],
        [-0.3, -0.45],
        [0.3, -0.45],
        [0.3, -0.95],
        [0.8, -0.95],
        [0.8, 0.95],
      ],
    },
  ],
  // 失步：横条按半高分三档，成片时厚板之间留一线纸色，像扫描线之间的缝
  slabthin: [slab(0.22)],
  slab: [slab(0.4)],
  slabwide: [slab(0.66)],
  blockhole: holed(0.26),
  blockhalf: [{ k: 'r', x: 0, y: BOX / 2, w: BOX, h: BOX / 2 }],
  // 短竖纹：三道等距的短竖线，和「竖纹」一样的间距，但用不出格的线段，上下只画到八成半径——
  // 邻格之间留下一道明显的横缝，整片下来是一笔笔断开的短竖，而不是通到底的长线
  comb: [seg(-2 / 3, -0.8, -2 / 3, 0.8), seg(0, -0.8, 0, 0.8), seg(2 / 3, -0.8, 2 / 3, 0.8)],
  // 叠圈：两个半径 0.62 的圆圈左右各挪 0.4，圆周相交，画出丝网海报里那种叠在一起的环
  ringpair: [
    { k: 'o', x: -0.4, y: 0, r: 0.62 },
    { k: 'o', x: 0.4, y: 0, r: 0.62 },
  ],
};

/** 按编码取图元表 */
const PRIMS_BY_CODE: ReadonlyArray<readonly Prim[]> = GLYPH_IDS.map((id) => GLYPH_PRIMS[id]);

/** 点到线段 AB 的距离 */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const len2 = bax * bax + bay * bay;
  let h = len2 > 0 ? (pax * bax + pay * bay) / len2 : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 点到实心多边形的有符号距离（iq 的写法）：顶点按顺序给，里面为负 */
function polygonDistance(px: number, py: number, pts: ReadonlyArray<readonly [number, number]>, scale: number): number {
  const n = pts.length;
  let d = Infinity;
  let sign = 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = pts[i][0] * scale;
    const ay = pts[i][1] * scale;
    const bx = pts[j][0] * scale;
    const by = pts[j][1] * scale;
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const len2 = ex * ex + ey * ey;
    let h = len2 > 0 ? (wx * ex + wy * ey) / len2 : 0;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = wx - ex * h;
    const dy = wy - ey * h;
    const dd = dx * dx + dy * dy;
    if (dd < d) d = dd;
    const c1 = py >= ay;
    const c2 = py < by;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d);
}

/** 圆圈的中线半径：外缘落在 r 上，太细时至少留一点 */
const ringRadius = (r: number, hw: number) => Math.max(r - hw, 0.25);
/** 方框 / 菱框 / 三角框的中线尺寸：往里缩一个半粗，外缘正好落在实心版的边上，描边版总比实心版墨少 */
const frameHalf = (h: number, hw: number) => Math.max(h - hw, 0.25);
const SQRT3 = 1.7320508075688772;
/** 六边框往里缩多少才让外缘落在外接圆半径 r 上：边到中心的距离是 r·√3/2，缩 hw 相当于外接圆半径缩 hw·2/√3 */
const HEX_INSET = 2 / SQRT3;

/**
 * 符号距离场。(x, y) 是相对格子中心、沿网格坐标轴的画布像素；r 是这一格的符号半径；
 * hw 是线的半粗；spanX / spanY 是跨格线段的半长（半格 + 半像素）。「空」返回 +∞。
 */
export function glyphDistance(code: number, x: number, y: number, r: number, hw: number, spanX: number, spanY: number): number {
  const prims = PRIMS_BY_CODE[code];
  let d = Infinity;
  for (let n = 0; n < prims.length; n++) {
    const p = prims[n];
    let dd: number;
    switch (p.k) {
      case 'c': {
        const dx = x - p.x * r;
        const dy = y - p.y * r;
        dd = Math.sqrt(dx * dx + dy * dy) - p.r * r;
        break;
      }
      case 'o': {
        const dx = x - p.x * r;
        const dy = y - p.y * r;
        dd = Math.abs(Math.sqrt(dx * dx + dy * dy) - ringRadius(p.r * r, hw)) - hw;
        break;
      }
      case 's':
        dd = segmentDistance(x, y, p.x1 * r, p.y1 * r, p.x2 * r, p.y2 * r) - hw;
        break;
      case 'S':
        dd = segmentDistance(x, y, p.x1 * spanX, p.y1 * spanY, p.x2 * spanX, p.y2 * spanY) - hw;
        break;
      case 't':
        dd = shapeDistance('triangle', x, y, r, 0);
        break;
      case 'T':
        dd = Math.abs(shapeDistance('triangle', x, y, frameHalf(r, hw * SQRT3), 0)) - hw;
        break;
      case 'v':
        dd = shapeDistance('triangle', x, -y, r, 0);
        break;
      case 'q':
        dd = shapeDistance('square', x, y, p.h * r, 0);
        break;
      case 'Q':
        dd = Math.abs(shapeDistance('square', x, y, frameHalf(p.h * r, hw), 0)) - hw;
        break;
      case 'b':
        dd = shapeDistance('square', x - p.x * r, y - p.y * r, p.h * r, 0);
        break;
      case 'r': {
        // 矩形的有符号距离：先取到两条中轴的距离减半边，外面按两轴的正分量取模长，里面取较大的那个（负值）
        const ex = Math.abs(x - p.x * r) - p.w * r;
        const ey = Math.abs(y - p.y * r) - p.h * r;
        const ox = ex > 0 ? ex : 0;
        const oy = ey > 0 ? ey : 0;
        dd = Math.min(Math.max(ex, ey), 0) + Math.sqrt(ox * ox + oy * oy);
        break;
      }
      case 'R':
        dd = Math.abs(shapeDistance('roundsquare', x, y, frameHalf(p.h * r, hw), 0)) - hw;
        break;
      case 'd':
        dd = shapeDistance('diamond', x, y, r, 0);
        break;
      case 'D':
        dd = Math.abs(shapeDistance('diamond', x, y, frameHalf(r, hw * Math.SQRT2), 0)) - hw;
        break;
      case 'g':
        dd = shapeDistance('hexagon', x, y, r, 0);
        break;
      case 'G':
        dd = Math.abs(shapeDistance('hexagon', x, y, frameHalf(r, hw * HEX_INSET), 0)) - hw;
        break;
      case 'V': {
        // 跨格竖带：横向是中心 x、半宽 w（都以半格为单位），纵向铺满整格
        const dx = Math.abs(x - p.x * spanX) - p.w * spanX;
        const dy = Math.abs(y) - spanY;
        dd = dx > dy ? dx : dy;
        break;
      }
      case 'O': {
        // 粗环：外缘落在 p.r·r 上，带的半宽是 w 乘这个半径——带宽不跟线粗走，w = 0.5 就填满整个圆
        const rr = p.r * r;
        const half = p.w * rr;
        dd = Math.abs(Math.sqrt(x * x + y * y) - (rr - half)) - half;
        break;
      }
      case 'P':
        dd = polygonDistance(x, y, p.pts, r);
        break;
    }
    if (dd < d) d = dd;
  }
  return d;
}

/** 两位小数，去掉 -0 与多余的 0 */
const f = (n: number) => {
  const s = (Math.round(n * 100) / 100).toString();
  return s === '-0' ? '0' : s;
};

function trianglePoints(cx: number, cy: number, r: number, down: boolean): string {
  const top = (2 * r) / SQRT3;
  const base = r / SQRT3;
  return down ? `${f(cx)},${f(cy + top)} ${f(cx + r)},${f(cy - base)} ${f(cx - r)},${f(cy - base)}` : `${f(cx)},${f(cy - top)} ${f(cx + r)},${f(cy + base)} ${f(cx - r)},${f(cy + base)}`;
}

function diamondPoints(cx: number, cy: number, r: number): string {
  return `${f(cx)},${f(cy - r)} ${f(cx + r)},${f(cy)} ${f(cx)},${f(cy + r)} ${f(cx - r)},${f(cy)}`;
}

function hexagonPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    pts.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/**
 * 符号的 SVG 图元：填充图形直接继承所在 <g> 的 fill；描边图形带 `fill="none"` 加 stroke，
 * 线粗与圆头写在 <g> 上。`fill` / `stroke` 是要附在元素上的属性串（原图色 / 分级配色时每颗点各自带色），可为空。
 */
export function glyphSvg(code: number, cx: number, cy: number, r: number, hw: number, spanX: number, spanY: number, fill: string, stroke: string): string[] {
  const out: string[] = [];
  for (const p of PRIMS_BY_CODE[code]) {
    switch (p.k) {
      case 'c':
        out.push(`<circle cx="${f(cx + p.x * r)}" cy="${f(cy + p.y * r)}" r="${f(p.r * r)}"${fill}/>`);
        break;
      case 'o':
        out.push(`<circle cx="${f(cx + p.x * r)}" cy="${f(cy + p.y * r)}" r="${f(ringRadius(p.r * r, hw))}" fill="none"${stroke}/>`);
        break;
      case 's':
        out.push(`<line x1="${f(cx + p.x1 * r)}" y1="${f(cy + p.y1 * r)}" x2="${f(cx + p.x2 * r)}" y2="${f(cy + p.y2 * r)}"${stroke}/>`);
        break;
      case 'S':
        out.push(`<line x1="${f(cx + p.x1 * spanX)}" y1="${f(cy + p.y1 * spanY)}" x2="${f(cx + p.x2 * spanX)}" y2="${f(cy + p.y2 * spanY)}"${stroke}/>`);
        break;
      case 't':
        out.push(`<polygon points="${trianglePoints(cx, cy, r, false)}"${fill}/>`);
        break;
      case 'T':
        out.push(`<polygon points="${trianglePoints(cx, cy, frameHalf(r, hw * SQRT3), false)}" fill="none"${stroke}/>`);
        break;
      case 'v':
        out.push(`<polygon points="${trianglePoints(cx, cy, r, true)}"${fill}/>`);
        break;
      case 'q': {
        const h = p.h * r;
        out.push(`<rect x="${f(cx - h)}" y="${f(cy - h)}" width="${f(2 * h)}" height="${f(2 * h)}"${fill}/>`);
        break;
      }
      case 'Q': {
        const h = frameHalf(p.h * r, hw);
        out.push(`<rect x="${f(cx - h)}" y="${f(cy - h)}" width="${f(2 * h)}" height="${f(2 * h)}" fill="none"${stroke}/>`);
        break;
      }
      case 'b': {
        const h = p.h * r;
        out.push(`<rect x="${f(cx + p.x * r - h)}" y="${f(cy + p.y * r - h)}" width="${f(2 * h)}" height="${f(2 * h)}"${fill}/>`);
        break;
      }
      case 'r':
        out.push(
          `<rect x="${f(cx + (p.x - p.w) * r)}" y="${f(cy + (p.y - p.h) * r)}" width="${f(2 * p.w * r)}" height="${f(2 * p.h * r)}"${fill}/>`,
        );
        break;
      case 'R': {
        const h = frameHalf(p.h * r, hw);
        out.push(`<rect x="${f(cx - h)}" y="${f(cy - h)}" width="${f(2 * h)}" height="${f(2 * h)}" rx="${f(h * ROUND_SQUARE_CORNER)}" fill="none"${stroke}/>`);
        break;
      }
      case 'd':
        out.push(`<polygon points="${diamondPoints(cx, cy, r)}"${fill}/>`);
        break;
      case 'D':
        out.push(`<polygon points="${diamondPoints(cx, cy, frameHalf(r, hw * Math.SQRT2))}" fill="none"${stroke}/>`);
        break;
      case 'g':
        out.push(`<polygon points="${hexagonPoints(cx, cy, r)}"${fill}/>`);
        break;
      case 'G':
        out.push(`<polygon points="${hexagonPoints(cx, cy, frameHalf(r, hw * HEX_INSET))}" fill="none"${stroke}/>`);
        break;
      case 'V':
        out.push(`<rect x="${f(cx + (p.x - p.w) * spanX)}" y="${f(cy - spanY)}" width="${f(2 * p.w * spanX)}" height="${f(2 * spanY)}"${fill}/>`);
        break;
      case 'O': {
        const rr = p.r * r;
        const half = p.w * rr;
        out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr - half)}" fill="none" stroke-width="${f(2 * half)}"${stroke}/>`);
        break;
      }
      case 'P':
        out.push(`<polygon points="${p.pts.map(([x, y]) => `${f(cx + x * r)},${f(cy + y * r)}`).join(' ')}"${fill}/>`);
        break;
    }
  }
  return out;
}

/** 算覆盖率时的参照：格子 32px，符号大小 80%，线粗 12%（与「符号」风格的默认值一致） */
const COVERAGE_PITCH = 32;
const COVERAGE_SIZE = 0.8;
const COVERAGE_STROKE = 0.12;
const COVERAGE_GRID = 48;

let coverageTable: Float32Array | null = null;

/**
 * 每种符号在默认大小与线粗下盖住格子的比例 0..1——「墨量」。选择器按它排序，
 * 推荐序列也按它校验：亮的阶梯配墨少的符号，暗的配墨多的。第一次用时算一遍，之后查表。
 */
export function glyphCoverage(code: number): number {
  if (!coverageTable) {
    coverageTable = new Float32Array(GLYPH_IDS.length);
    const r = (COVERAGE_PITCH / 2) * COVERAGE_SIZE;
    const hw = Math.max((COVERAGE_STROKE * COVERAGE_PITCH) / 2, 0.35);
    const span = COVERAGE_PITCH / 2 + 0.5;
    const n = COVERAGE_GRID;
    for (let c = 0; c < GLYPH_IDS.length; c++) {
      let inside = 0;
      for (let j = 0; j < n; j++) {
        const y = ((j + 0.5) / n - 0.5) * COVERAGE_PITCH;
        for (let i = 0; i < n; i++) {
          const x = ((i + 0.5) / n - 0.5) * COVERAGE_PITCH;
          if (glyphDistance(c, x, y, r, hw, span, span) < 0) inside++;
        }
      }
      coverageTable[c] = inside / (n * n);
    }
  }
  return coverageTable[code];
}

/** 全部符号按墨量从少到多排（「空」在最前） */
export function glyphsByCoverage(): GlyphId[] {
  return GLYPH_IDS.slice().sort((a, b) => glyphCoverage(GLYPH_CODE[a]) - glyphCoverage(GLYPH_CODE[b]));
}

/** 明暗档：墨量 0..1 落在 n 档里的第几档（0 最亮）；jitter 给交界处加一点随机，最多挪半档 */
export function glyphBand(coverage: number, n: number, jitter: number, noise: number): number {
  const c = coverage + (noise - 0.5) * jitter * (1 / n);
  const band = Math.floor(c * n);
  return band < 0 ? 0 : band >= n ? n - 1 : band;
}

/** 点缀符号：交界处的概率是密度本身，成片区域里只留三成，免得铺满 */
export const ACCENT_INTERIOR = 0.3;
/** 点缀符号至少占格子多大（相对「符号大小」），亮处的小点旁边才看得出它是个圈 */
export const ACCENT_MIN_SIZE = 0.6;
const ACCENT_CODES = [GLYPH_CODE.ring, GLYPH_CODE.triline];

export interface GlyphAssignOptions {
  /** 从亮到暗每一阶用的符号 */
  ramp: readonly GlyphId[];
  /** 交界混合 0..1 */
  mix: number;
  /** 点缀符号密度 0..1 */
  accent: number;
  seed: number;
}

export interface GlyphAssignment {
  /** 每格的符号编码（`GLYPH_IDS` 的下标，0 是空） */
  glyph: Uint8Array;
  /** 每格落在第几阶（0 最亮），−1 是没采到画面的格子 */
  band: Int16Array;
  /** 这一格是不是被点缀符号换掉了 */
  accent: Uint8Array;
}

/**
 * 给一张网格的每个格子挑符号：按墨量分档取序列里的那一个，交界处按 mix 随机互换；
 * 再按密度撒圆圈 / 三角框做点缀——多落在两档交界的格子上，「空」档上不撒。
 * `coverage` 每格一个墨量，−1 表示这一格没采到画面。
 * 用绝对格坐标 (i, j) 做哈希，画布变大、网格挪动时已有格子的符号不变。
 */
export function assignGlyphs(cells: { cols: number; rows: number; i0: number; j0: number }, coverage: Float32Array, opts: GlyphAssignOptions): GlyphAssignment {
  const { cols, rows, i0, j0 } = cells;
  const n = opts.ramp.length;
  const codes = opts.ramp.map((id) => GLYPH_CODE[id]);
  const band = new Int16Array(cols * rows).fill(-1);
  for (let jj = 0; jj < rows; jj++) {
    for (let ii = 0; ii < cols; ii++) {
      const k = jj * cols + ii;
      const c = coverage[k];
      if (c < 0) continue;
      const noise = opts.mix > 0 ? hash2(i0 + ii, j0 + jj, opts.seed) : 0.5;
      band[k] = glyphBand(c, n, opts.mix, noise);
    }
  }
  const glyph = new Uint8Array(cols * rows);
  const accent = new Uint8Array(cols * rows);
  const blank = GLYPH_CODE.blank;
  for (let jj = 0; jj < rows; jj++) {
    for (let ii = 0; ii < cols; ii++) {
      const k = jj * cols + ii;
      const b = band[k];
      if (b < 0) continue;
      let code = codes[b];
      if (opts.accent > 0 && code !== blank) {
        const differs = (kk: number) => band[kk] >= 0 && band[kk] !== b;
        const boundary = (ii > 0 && differs(k - 1)) || (ii < cols - 1 && differs(k + 1)) || (jj > 0 && differs(k - cols)) || (jj < rows - 1 && differs(k + cols));
        const p = opts.accent * (boundary ? 1 : ACCENT_INTERIOR);
        if (hash2(i0 + ii, j0 + jj, opts.seed + 101) < p) {
          code = ACCENT_CODES[hash2(i0 + ii, j0 + jj, opts.seed + 202) < 0.5 ? 0 : 1];
          accent[k] = 1;
        }
      }
      glyph[k] = code;
    }
  }
  return { glyph, band, accent };
}

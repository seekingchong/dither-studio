import type { ParamGroup } from '@/params';

export interface GroupMeta {
  id: ParamGroup;
  label: string;
  hint: string;
}

/** 左栏分区顺序与文案（画布尺寸 / 适配在预览区右上角的「画布」菜单里，不在左栏） */
export const GROUPS: GroupMeta[] = [
  { id: 'pixel', label: '像素化', hint: '像素尺寸是降采样倍率，决定颗粒粗细；降采样方法决定缩小时如何合并像素。网格偏移在"更多"里。' },
  { id: 'tone', label: '影调', hint: '抖动前的亮度处理。阈值给量化前的亮度加固定偏置，用来补偿有序抖动整体偏亮，也是 1-bit 下最重要的创意滑块。' },
  { id: 'dither', label: '抖动算法', hint: '算法族和具体算法在顶部选择，这里是当前算法族自己的参数。' },
  {
    id: 'color',
    label: '颜色',
    hint: '单色两色、灰阶 / Tint 按亮度分级着色、Palette 做真彩量化、Channels 对 RGB 或 CMYK 分通道抖动。色块可以点开改颜色或直接输入色值；Accent 层在结果上按规则撒强调色。',
  },
  { id: 'grid', label: '网格', hint: '把每个像素格画成网点：欧几里得或圆方网点、反向、随明暗缩放；点融合让相邻网点粘连；横纵间距留出背景；背景可铺每行 / 每列一根线或每格一个图形。像素尺寸越大越明显。' },
  { id: 'effects', label: '特效', hint: '在最终画面上叠加的后处理，按列表顺序依次应用。点选项添加，可添加多个、调整顺序或临时关闭。' },
];

/** 顶部快捷参数（4 列 grid） */
export const QUICK_PARAMS = ['dither.family', 'color.mode', 'pixel.size'];

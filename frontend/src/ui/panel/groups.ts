import type { ParamGroup } from '@/params';

export interface GroupMeta {
  id: ParamGroup;
  label: string;
  hint: string;
}

/** 左栏分区顺序与文案 */
export const GROUPS: GroupMeta[] = [
  { id: 'pixel', label: '像素化', hint: '像素尺寸是降采样倍率，决定颗粒粗细；降采样方法决定缩小时如何合并像素。网格偏移在"更多"里。' },
  { id: 'tone', label: '影调', hint: '抖动前的亮度处理。阈值给量化前的亮度加固定偏置，用来补偿有序抖动整体偏亮，也是 1-bit 下最重要的创意滑块。' },
  { id: 'dither', label: '抖动算法', hint: '算法族和具体算法在顶部选择，这里是当前算法族自己的参数。' },
  { id: 'color', label: '颜色', hint: '单色 / 灰阶 / Tint 按亮度分级着色；Palette 做真彩量化（打开深度错配则先按 N 级亮度抖动再按索引映射）；Channels 对 RGB 或 CMYK 分通道抖动。Accent 层在结果上按规则撒强调色。' },
  { id: 'canvas', label: '画布', hint: '画布尺寸就是导出尺寸，默认 1000 × 600。适配方式决定源图如何放进画布。' },
  { id: 'grid', label: '网格', hint: '点融合、网点形状、网格间距与背景。' },
  { id: 'effects', label: '特效', hint: '可堆叠的后处理特效。' },
];

/** 顶部快捷参数（4 列 grid） */
export const QUICK_PARAMS = ['dither.family', 'color.mode', 'pixel.size'];

/**
 * 「界面预览」里那张静态界面的尺寸与文案。
 * 来源：Figma「书庆」文件画板 tdc home（node 45:3223），
 * 数值都是设计稿上的像素，界面按原尺寸画好之后整体缩放到窗口里。
 */

/**
 * 画板尺寸。只有这一组要给 JS 用（算缩放比例、开窗大小），
 * 其余分块尺寸（导航条 120、侧栏 234、卡片 360 等）都写在 interface-preview.css 里，
 * 不在这儿留一份对不上的副本。
 */
export const FRAME_WIDTH = 1728;
export const FRAME_HEIGHT = 1080;

/**
 * 封面图里的「video cover」容器（45:3247）——用户的视频 / 图片就放这儿。
 * 设计稿上这个节点带了一次水平镜像，左边界要按镜像后的视觉位置算（181.885 - 98.958）。
 */
export const VIDEO_COVER = { left: 82.93, top: 78.375, width: 98.958, height: 59.375, radius: 7.125 };

/** 封面图里盖在 video cover 右上角的白色小卡（45:3248「Group 5507」） */
export const COVER_TIP = { left: 160.11, top: 47.5, width: 98.958, height: 59.375, radius: 7.125 };

/** 封面图右下角那个橙色箭头（45:3258） */
export const COVER_ARROW = { left: 250.36, top: 98.17, size: 13.458 };

export interface SkillGroup {
  /** 分组序号 */
  number: string;
  name: string;
  items: string[];
}

/**
 * 侧栏的技能分组。设计稿上这份列表比可视区长，滚动区上下各有一条渐隐；
 * 这里只收录画板上能读到的条目，读不到的（画板下边界之外）不臆造。
 */
export const SKILL_GROUPS: SkillGroup[] = [
  { number: '1', name: '需求理解', items: ['业务概述获取', '设计 Brief 转译', '数据指标确定', '需求投入评估'] },
  {
    number: '2',
    name: '用户研究',
    items: ['问卷调研', '深度访谈', '圆桌访谈', '用户投票', '用户需求调研', '满意度调研', '合成用户', 'VOC 与评价聚类', '舆情与情绪分析'],
  },
  { number: '3', name: '问题定义', items: ['体验问题自查', '痛点聚类', '故事线生成'] },
  { number: '4', name: '设计策略', items: ['体验愿景', '头脑风暴', '解法可行性评估', '体验目标拆解'] },
];

/** 设计稿上处于选中态的那一条 */
export const SELECTED_SKILL = '深度访谈';

/** 卡片里的应用描述与详情，照抄设计稿 */
export const APP_DESCRIPTION =
  '文字系统生成器是一款面向 UI 设计与前端开发的智能工具。用自然语言描述，自动拆解完整文字系统——涵盖文字类型、字体、字阶、字重样式、多语言与自适应规则，实时生成可预览、可调节的方案，并最终一键导出前端可直接使用的代码。';

export const APP_DETAILS = [
  { label: '使用量', value: '268', latin: true },
  { label: '更新日期', value: '2026.06.18', latin: true },
  { label: '类型', value: '技能', icon: true },
  { label: '开发者', value: '别寻', brand: true },
] as const;

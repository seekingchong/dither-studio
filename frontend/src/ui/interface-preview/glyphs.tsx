import type { ReactNode, SVGProps } from 'react';

/**
 * 静态界面里用到的图标。
 *
 * 设计稿里这些是导出的 SVG 资源，但本仓库的构建环境访问不到 Figma 的资源域名，
 * 所以照着画板按项目自己的图标画法（1.5px 线、currentColor、偶数视框）重画一遍，
 * 形状与位置对齐设计稿，颜色交给外面的 CSS。纯装饰，一律 aria-hidden。
 */

type GlyphProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 16, viewBox = '0 0 16 16', children, ...rest }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 侧栏收起：一个方框，靠左一条竖分隔 */
export const CollapseGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 14 14" {...p}>
    <rect x="1.4" y="2.4" width="11.2" height="9.2" rx="2" />
    <path d="M5.6 2.4v9.2" />
  </Glyph>
);

/** 分组收起的向上尖角 */
export const ChevronUpGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 14 14" {...p}>
    <path d="M3.6 8.4 7 5l3.4 3.4" />
  </Glyph>
);

/** 技能条目前的节点图：上面一个点，下面两个点，连起来 */
export const SkillGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 16 16" {...p}>
    <circle cx="8" cy="3.4" r="1.9" />
    <circle cx="3.6" cy="12.2" r="1.9" />
    <circle cx="12.4" cy="12.2" r="1.9" />
    <path d="M8 5.3v2.4M4.6 10.5 7.2 7.9M11.4 10.5 8.8 7.9" />
  </Glyph>
);

/** 会话旁边的历史钟 */
export const HistoryGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 14 14" {...p}>
    <circle cx="7" cy="7" r="5.3" />
    <path d="M7 4.1V7l2.1 1.4" />
  </Glyph>
);

/** 新建会话：气泡加号 */
export const CommentAddGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" {...p}>
    <path d="M15.6 8.6c0 3.6-2.9 6.5-6.6 6.5-1 0-2-.2-2.9-.6l-3.7 1 1-3.4a6.4 6.4 0 0 1-1-3.5C2.4 5 5.3 2.1 9 2.1s6.6 2.9 6.6 6.5Z" />
    <path d="M9 6.3v4.6M6.7 8.6h4.6" />
  </Glyph>
);

/** 导航条中间那颗点簇 */
export const ClusterGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" strokeWidth="0" {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="9" r="1.7" />
      <circle cx="9" cy="3.4" r="1.35" />
      <circle cx="9" cy="14.6" r="1.35" />
      <circle cx="4.15" cy="6.2" r="1.35" />
      <circle cx="13.85" cy="6.2" r="1.35" />
      <circle cx="4.15" cy="11.8" r="1.35" />
      <circle cx="13.85" cy="11.8" r="1.35" />
    </g>
  </Glyph>
);

/** 导航条底部那本册子 */
export const BookGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" {...p}>
    <rect x="3" y="2.4" width="12" height="13.2" rx="2.2" />
    <path d="M6.4 2.4v13.2M9 6.2h3.2M9 9h3.2" />
  </Glyph>
);

/** 输入框左侧的加号 */
export const AddGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" {...p}>
    <path d="M9 3.6v10.8M3.6 9h10.8" />
  </Glyph>
);

/** 话筒 */
export const MicGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" {...p}>
    <rect x="6.6" y="1.9" width="4.8" height="8.4" rx="2.4" />
    <path d="M3.9 8.1a5.1 5.1 0 0 0 10.2 0M9 13.2v2.9" />
  </Glyph>
);

/** 发送 */
export const ArrowUpGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 18 18" {...p}>
    <path d="M9 14.4V3.6M4.5 8.1 9 3.6l4.5 4.5" />
  </Glyph>
);

/** 封面小卡里的柱状图 */
export const ChartGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 12 12" strokeWidth="0" {...p}>
    <g fill="currentColor" stroke="none">
      <rect x="1.3" y="6.4" width="2.2" height="4.3" rx="0.7" />
      <rect x="4.9" y="3.6" width="2.2" height="7.1" rx="0.7" />
      <rect x="8.5" y="1.3" width="2.2" height="9.4" rx="0.7" />
    </g>
  </Glyph>
);

/** 类型行前的说明圆点 */
export const InfoGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 14 14" {...p}>
    <circle cx="7" cy="7" r="5.4" />
    <path d="M7 6.3v3.4" />
    <circle cx="7" cy="4.3" r="0.55" fill="currentColor" stroke="none" />
  </Glyph>
);

/** 封面右下角那支橙色指针 */
export const CursorArrowGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 14 14" strokeWidth="0" {...p}>
    <path d="M3.1 1.6 12 6.9l-3.9.9-1.7 3.7z" fill="currentColor" stroke="none" />
  </Glyph>
);

/** 页脚模型标记 */
export const ModelMarkGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 11 11" strokeWidth="0" {...p}>
    <g fill="currentColor" stroke="none">
      <path d="M5.5.9 9.6 3.3v4.4L5.5 10.1 1.4 7.7V3.3z" opacity="0.55" />
      <circle cx="5.5" cy="5.5" r="1.6" />
    </g>
  </Glyph>
);

/** 侧栏顶部的品牌标记：两枚三角加一个圆点 */
export const BrandMarkGlyph = (p: GlyphProps) => (
  <Glyph viewBox="0 0 26 10" strokeWidth="0" {...p}>
    <g fill="currentColor" stroke="none">
      <path d="M0.6 2.2h7.4L4.3 8.3z" />
      <path d="M8.8 2.2h7.4L12.5 8.3z" />
      <circle cx="21.4" cy="5.2" r="3.1" />
    </g>
  </Glyph>
);

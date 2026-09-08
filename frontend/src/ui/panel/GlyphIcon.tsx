import { GLYPH_CODE, glyphSvg, type GlyphId } from '@/engine';

interface GlyphIconProps {
  id: GlyphId;
  /** 边长（CSS 像素）；符号按格子 80%、线粗 12% 画，与「符号」风格的默认值一致 */
  size?: number;
  className?: string;
}

/**
 * 一个符号的缩略图：直接用引擎的 SVG 导出（`glyphSvg`）画，所以面板上看到的就是导出里的那一笔。
 * 填充图元继承根节点的 fill，描边图元各自带 stroke，根节点 stroke 关掉免得实心图形也镶一圈边。
 */
export function GlyphIcon({ id, size = 24, className }: GlyphIconProps) {
  const r = size * 0.4;
  const hw = Math.max(size * 0.06, 0.6);
  const half = size / 2;
  const html = glyphSvg(GLYPH_CODE[id], half, half, r, hw, half, half, '', ' stroke="currentColor"').join('');
  return (
    <svg
      className={['glyph-icon', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="currentColor"
      stroke="none"
      strokeWidth={hw * 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

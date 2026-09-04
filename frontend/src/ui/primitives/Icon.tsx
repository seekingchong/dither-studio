import type { SVGProps } from 'react';

export type IconName = 'chevron' | 'check' | 'image' | 'folder' | 'copy' | 'download' | 'plus' | 'logo' | 'close' | 'up' | 'down' | 'trash' | 'play' | 'pause' | 'settings' | 'film' | 'undo' | 'redo' | 'save' | 'edit' | 'star';

const PATHS: Record<IconName, string> = {
  chevron: 'M3 4.5l3 3 3-3',
  check: 'M2.5 6.5l2.5 2.5 4.5-5',
  image: 'M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM1.5 10.5l3.5-3.5 3 3 2-2 4.5 4.5M10.5 6.5h.01',
  folder: 'M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  download: 'M8 2.5v8M4.5 7l3.5 3.5L11.5 7M2.5 13.5h11',
  plus: 'M8 3v10M3 8h10',
  logo: 'M2 2h14v14H2zM6 9h6M9 6v6',
  close: 'M4 4l8 8M12 4l-8 8',
  up: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  down: 'M8 3v10M3.5 8.5L8 13l4.5-4.5',
  trash: 'M3 4.5h10M6.5 4.5v-1h3v1M4.5 4.5l.7 8.5h5.6l.7-8.5M6.8 7v4M9.2 7v4',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  settings: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM13.2 9.6l1.1.7-1.2 2.1-1.3-.4a4.8 4.8 0 0 1-1.4.8L10.1 14H5.9l-.3-1.2a4.8 4.8 0 0 1-1.4-.8l-1.3.4-1.2-2.1 1.1-.7a5 5 0 0 1 0-1.6l-1.1-.7 1.2-2.1 1.3.4a4.8 4.8 0 0 1 1.4-.8L5.9 2h4.2l.3 1.2c.5.2 1 .5 1.4.8l1.3-.4 1.2 2.1-1.1.7a5 5 0 0 1 0 1.6z',
  film: 'M2.5 3.5h11v9h-11zM2.5 6h11M2.5 10h11M5.5 3.5v9M10.5 3.5v9',
  undo: 'M6 4L2.5 7.5 6 11M2.5 7.5h7a4 4 0 0 1 0 8H8',
  redo: 'M10 4l3.5 3.5L10 11M13.5 7.5h-7a4 4 0 0 0 0 8H8',
  save: 'M3 2.5h8l2.5 2.5v8.5h-11zM5.5 2.5v4h5v-4M5 13.5v-4h6v4',
  edit: 'M11.5 2.5l2 2-8 8-3 1 1-3zM10 4l2 2',
  star: 'M8 2.5l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.3l-3.5 1.9.8-3.9L2.4 6.6l3.9-.5z',
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

/** 线性图标：stroke currentColor、1.5px，尺寸 12 / 16 / 18 */
export function Icon({ name, size = 16, ...rest }: IconProps) {
  if (name === 'logo') {
    // 应用标志：与 build/icon.svg 同一几何与色值的圆角版本——#D7D6D4 圆角底（rx 约 22%）上两个对角相接的 #1D1711 圆角方块。
    // 品牌色固定，不随主题 / 文字色变化
    return (
      <svg className="tda-icon tda-icon--logo" width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true" {...rest}>
        <rect width="512" height="512" rx="114" fill="#D7D6D4" />
        <rect x="80" y="80" width="176" height="176" rx="48" fill="#1D1711" />
        <rect x="256" y="256" width="176" height="176" rx="48" fill="#1D1711" />
      </svg>
    );
  }
  const viewBox = name === 'chevron' ? '0 0 12 12' : '0 0 16 16';
  return (
    <svg
      className="tda-icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

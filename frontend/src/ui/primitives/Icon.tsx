import type { SVGProps } from 'react';

export type IconName = 'chevron' | 'check' | 'image' | 'folder' | 'copy' | 'download' | 'plus' | 'logo' | 'close';

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
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

/** 线性图标：stroke currentColor、1.5px，尺寸 12 / 16 / 18 */
export function Icon({ name, size = 16, ...rest }: IconProps) {
  const viewBox = name === 'chevron' ? '0 0 12 12' : name === 'logo' ? '0 0 18 18' : '0 0 16 16';
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

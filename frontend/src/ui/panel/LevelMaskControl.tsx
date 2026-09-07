import { levelEnabled } from '@/engine';

interface LevelMaskControlProps {
  label: string;
  /** '0' / '1' 组成的串，第 i 位是第 i 阶（0 最亮），缺位视为开 */
  value: string;
  /** 现在分几阶 */
  count: number;
  onChange: (value: string) => void;
  'data-param'?: string;
}

const MAX_CHIPS = 32;

/** 这一阶代表的亮度画成灰色块：最亮一阶纯白，最暗一阶纯黑 */
const grayHex = (i: number, n: number) => {
  const v = Math.round((n <= 1 ? 1 : 1 - i / (n - 1)) * 255);
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
};

/**
 * 灰度块描边的逐阶开关：一阶一枚芯片（明暗色块 + 序号），从最亮排到最暗，按下的阶描边、抬起的不描。
 * 写回的串按当前阶数补齐，阶数改多了新阶默认开、改少了多出的位由引擎忽略。
 */
export function LevelMaskControl({ label, value, count, onChange, ...rest }: LevelMaskControlProps) {
  const n = Math.max(1, Math.min(MAX_CHIPS, Math.round(count) || 1));
  const toggle = (i: number) => {
    const next = Array.from({ length: n }, (_, k) => (levelEnabled(value, k) ? '1' : '0'));
    next[i] = next[i] === '1' ? '0' : '1';
    onChange(next.join(''));
  };
  const levelName = (i: number) => `第 ${i + 1} 阶${i === 0 ? '（最亮）' : i === n - 1 ? '（最暗）' : ''}`;

  return (
    <div className="tda-field level-mask" role="group" aria-label={label} {...rest}>
      <span className="tda-field__label" title="从最亮到最暗一阶一枚；一条边两侧的阶都关了才不描">
        {label}
      </span>
      <div className="level-mask__chips">
        {Array.from({ length: n }, (_, i) => {
          const on = levelEnabled(value, i);
          return (
            <button
              key={i}
              type="button"
              className="level-mask__chip"
              aria-pressed={on}
              aria-label={`${levelName(i)}描边`}
              title={`${levelName(i)}：${on ? '描边' : '不描'}，点击切换`}
              data-level={i + 1}
              onClick={() => toggle(i)}
            >
              <span className="level-mask__swatch" style={{ background: grayHex(i, n) }} aria-hidden="true" />
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

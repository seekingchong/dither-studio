import { useEffect, useState } from 'react';

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  'data-param'?: string;
}

/** 数字输入：与下拉同框同高，标签 + 右对齐数值 + 单位；失焦 / 回车提交，上下方向键步进 */
export function NumberField({ label, value, min, max, step = 1, unit, onChange, disabled, className, ...rest }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) {
      const next = clamp(Math.round(n / step) * step);
      if (next !== value) onChange(next);
      setText(String(next));
    } else {
      setText(String(value));
    }
  };

  return (
    <label className={['tda-field tda-number', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')} {...rest}>
      <span className="tda-field__label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        className="tda-number__input"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = Number(text);
            const base = Number.isFinite(n) ? n : value;
            const next = clamp(base + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
            setText(String(next));
            onChange(next);
          }
        }}
        aria-label={label}
      />
      {unit && <span className="tda-number__unit">{unit}</span>}
    </label>
  );
}

import { useEffect, useState } from 'react';

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  /** 拖动结束（用于撤销栈合并） */
  onCommit?: () => void;
  disabled?: boolean;
  'data-param'?: string;
}

/** 滑块：与下拉同样 40px 高、同样描边圆角；标签 + 滑轨 + 可编辑数值 */
export function SliderField({ label, value, min, max, step, unit, onChange, onCommit, disabled, ...rest }: SliderFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commitText = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
    onCommit?.();
  };

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <label className={['tda-field tda-slider', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} {...rest}>
      <span className="tda-field__label">{label}</span>
      <input
        type="range"
        className="tda-slider__range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--tda-slider-fill': `${percent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
      />
      <span className="tda-slider__value">
        <input
          type="text"
          inputMode="decimal"
          className="tda-slider__input"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label={label}
        />
        {unit && <span className="tda-slider__unit">{unit}</span>}
      </span>
    </label>
  );
}

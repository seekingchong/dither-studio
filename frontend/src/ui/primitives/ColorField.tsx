import { useEffect, useState } from 'react';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'data-param'?: string;
}

const HEX = /^#?([0-9a-fA-F]{6})$/;

/** 颜色：标签 + 色块（点开系统取色器）+ 可编辑十六进制 */
export function ColorField({ label, value, onChange, disabled, ...rest }: ColorFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    const m = HEX.exec(text.trim());
    if (m) onChange(`#${m[1].toUpperCase()}`);
    else setText(value);
  };

  return (
    <div className={['tda-field tda-color', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} {...rest}>
      <span className="tda-field__label">{label}</span>
      <label className="tda-color__swatch" style={{ background: value }}>
        <input
          type="color"
          className="tda-color__picker"
          value={value.toLowerCase()}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label} 取色`}
        />
      </label>
      <input
        type="text"
        className="tda-color__hex"
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={label}
      />
    </div>
  );
}

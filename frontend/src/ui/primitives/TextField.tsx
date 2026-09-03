import { useEffect, useState } from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  'data-param'?: string;
}

/** 文本：单行与下拉同框同高；多行是同样描边圆角的文本域（用于自定义扩散核） */
export function TextField({ label, value, onChange, multiline, placeholder, disabled, ...rest }: TextFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onChange(text);
  };

  if (multiline) {
    return (
      <label className={['tda-field tda-textarea', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} {...rest}>
        <span className="tda-field__label">{label}</span>
        <textarea
          className="tda-textarea__input"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          aria-label={label}
        />
      </label>
    );
  }

  return (
    <label className={['tda-field tda-text', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} {...rest}>
      <span className="tda-field__label">{label}</span>
      <input
        type="text"
        className="tda-text__input"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={label}
      />
    </label>
  );
}

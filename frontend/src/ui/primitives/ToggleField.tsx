import type { HelpContent } from '@/ui/state/helpStore';
import { HelpLabel } from './Help';

interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  'data-param'?: string;
  /** 标签上的解读浮层 */
  help?: HelpContent | null;
}

/** 开关：标签在左，开关在右，整体与下拉同框同高 */
export function ToggleField({ label, value, onChange, disabled, help, ...rest }: ToggleFieldProps) {
  return (
    <label className={['tda-field tda-toggle', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} {...rest}>
      <HelpLabel content={help ?? null} className="tda-field__label">
        {label}
      </HelpLabel>
      <span className="tda-toggle__state">{value ? '开启' : '关闭'}</span>
      <input
        type="checkbox"
        role="switch"
        className="tda-toggle__input"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="tda-toggle__track" aria-hidden="true">
        <span className="tda-toggle__thumb" />
      </span>
    </label>
  );
}

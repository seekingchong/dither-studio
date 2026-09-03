import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', icon, children, className, type = 'button', ...rest }: ButtonProps) {
  const cls = [`tda-btn-${variant}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
}

export function IconButton({ icon, label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={['tda-iconbtn', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={18} />
    </button>
  );
}

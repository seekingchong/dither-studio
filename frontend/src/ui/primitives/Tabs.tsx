export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** plain：无下划线（顶部 tab）；underline：48px 高、选中项 1px 底线 */
  variant?: 'plain' | 'underline';
  className?: string;
}

export function Tabs<T extends string>({ items, value, onChange, variant = 'plain', className }: TabsProps<T>) {
  return (
    <div role="tablist" className={[`tda-tabs tda-tabs--${variant}`, className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={['tda-tab', item.id === value ? 'is-active' : ''].filter(Boolean).join(' ')}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

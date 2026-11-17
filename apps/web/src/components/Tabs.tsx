import type { ReactNode } from 'react';
import { cn } from './ui';

export interface TabDefinition<Value extends string> {
  value: Value;
  label: string;
}

/**
 * Accessible tab strip shared by the operational modules. Pages stay in control
 * of the panel rendering so each tab can lazily fetch only what it needs.
 */
export function Tabs<Value extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: Value;
  onChange: (value: Value) => void;
  tabs: Array<TabDefinition<Value>>;
  label: string;
}): ReactNode {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-full border-2 px-4 py-1.5 text-sm font-bold transition',
            value === tab.value
              ? 'border-brand-900 bg-sun text-ink shadow-[0_3px_0_var(--color-brand-900)]'
              : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-slate-800',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

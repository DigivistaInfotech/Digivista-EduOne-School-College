import type { ComponentProps, ReactNode } from 'react';

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/* ---------------------------------- icons -------------------------------- */

const ICON_PATHS = {
  dashboard:
    'M3 3h7v7H3V3Zm0 11h7v7H3v-7Zm11-11h7v7h-7V3Zm0 11h7v7h-7v-7Z',
  calendar:
    'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  layers: 'm12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  clipboard:
    'M9 2h6v4H9V2Zm-2 2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1M8 12h8m-8 4h5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  search: 'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  alert: 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
  check: 'm20 6-11 11-5-5',
  home: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z',
  child: 'M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10ZM4 22v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  chart: 'M3 3v18h18M7 16v-5m4 5V8m4 8v-3m4 3V6',
  download: 'M12 3v12m0 0 5-5m-5 5-5-5M5 21h14',
  paperclip:
    'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  camera:
    'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  navigation: 'm3 11 19-9-9 19-2-8-8-2z',
  tablet:
    'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-6 17a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
  'log-in': 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  bus: 'M4 16v-8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8 M4 16h16 M4 16v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3 M17 16v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3 M4 11h16 M7 7h2 M15 7h2',
  qr: 'M3 3h6v6H3V3zm12 0h6v6h-6V3zm0 12h6v6h-6v-6zM3 15h6v6H3v-6zm3-10v2h2V5H6zm12 0v2h2V5h-2zm-12 12v2h2v-2H6zm10 2h2v2h-2v-2zm-2-2h2v2h-2v-2zm4 4h2v2h-2v-2zm2-2h2v2h-2v-2z',
  mapPin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  arrowRight: 'M5 12h14 M12 5l7 7-7 7',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0', className)}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* --------------------------------- buttons ------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'review' | 'learning';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[#087F83] text-white hover:bg-[#066669] active:bg-[#055356] focus-visible:ring-2 focus-visible:ring-[#087F83] focus-visible:ring-offset-2 disabled:bg-slate-300 disabled:text-slate-500 shadow-xs',
  secondary:
    'border-2 border-[#087F83] text-[#087F83] bg-white hover:bg-[#DDF4EC]/40 active:bg-[#DDF4EC] focus-visible:ring-2 focus-visible:ring-[#087F83] focus-visible:ring-offset-2 disabled:border-slate-200 disabled:text-slate-400',
  ghost:
    'text-slate-700 hover:bg-[#DDF4EC]/40 hover:text-[#087F83] active:bg-[#DDF4EC] disabled:text-slate-300',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 disabled:bg-rose-300 shadow-xs',
  review:
    'bg-[#F6B84B] text-[#182944] hover:bg-[#e4a83c] active:bg-[#d0962d] focus-visible:ring-2 focus-visible:ring-[#F6B84B] focus-visible:ring-offset-2 disabled:bg-amber-200 shadow-xs',
  learning:
    'bg-[#7654C7] text-white hover:bg-[#6242b1] active:bg-[#52339d] focus-visible:ring-2 focus-visible:ring-[#7654C7] focus-visible:ring-offset-2 disabled:bg-purple-200 shadow-xs',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}): ReactNode {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition focus-visible:outline-none disabled:cursor-not-allowed select-none min-h-[44px]',
        size === 'sm' ? 'px-3.5 py-1.5 text-xs min-h-[38px]' : size === 'lg' ? 'px-6 py-3 text-base min-h-[48px]' : 'px-5 py-2.5 text-sm min-h-[44px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ComponentProps<'a'> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
}): ReactNode {
  return (
    <a
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition focus-visible:outline-none min-h-[44px]',
        size === 'sm' ? 'px-3.5 py-1.5 text-xs min-h-[38px]' : size === 'lg' ? 'px-6 py-3 text-base min-h-[48px]' : 'px-5 py-2.5 text-sm min-h-[44px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </a>
  );
}

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <svg
      className={cn('animate-spin text-current', className ?? 'h-5 w-5')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------- fields -------------------------------- */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="space-y-1">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-1 text-rose-500 font-bold">*</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          <Icon name="alert" className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>): ReactNode {
  return <input {...props} className={cn('field-input', className)} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>): ReactNode {
  return <select {...props} className={cn('field-input', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>): ReactNode {
  return <textarea {...props} className={cn('field-input min-h-24', className)} />;
}

/* ---------------------------------- badges --------------------------------- */

export type Tone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'brand'
  | 'mint'
  | 'sun'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'yellow'
  | 'orchid';

const TONES: Record<Tone, { badge: string; icon: IconName }> = {
  neutral: { badge: 'bg-slate-100 text-slate-700 ring-slate-300', icon: 'clipboard' },
  success: { badge: 'bg-[#DDF4EC] text-[#087F83] ring-[#087F83]/30', icon: 'check' },
  warning: { badge: 'bg-[#FEF6E9] text-[#B47408] ring-[#F6B84B]/40', icon: 'alert' },
  danger: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', icon: 'close' },
  info: { badge: 'bg-sky-50 text-sky-800 ring-sky-200', icon: 'paperclip' },
  brand: { badge: 'bg-[#182944]/10 text-[#182944] ring-[#182944]/20', icon: 'book' },
  mint: { badge: 'bg-[#DDF4EC] text-[#087F83] ring-[#087F83]/30', icon: 'check' },
  sun: { badge: 'bg-[#FEF6E9] text-[#B47408] ring-[#F6B84B]/40', icon: 'alert' },
  emerald: { badge: 'bg-[#DDF4EC] text-[#087F83] ring-[#087F83]/30', icon: 'check' },
  amber: { badge: 'bg-[#FEF6E9] text-[#B47408] ring-[#F6B84B]/40', icon: 'alert' },
  rose: { badge: 'bg-rose-50 text-rose-700 ring-rose-200', icon: 'close' },
  yellow: { badge: 'bg-[#FEF6E9] text-[#B47408] ring-[#F6B84B]/40', icon: 'alert' },
  orchid: { badge: 'bg-[#F3EFFC] text-[#7654C7] ring-[#7654C7]/30', icon: 'book' },
};

/**
 * Blueprint Requirement: "Status always includes text/icon, never colour alone."
 */
export function Badge({
  tone = 'neutral',
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: IconName;
  className?: string;
}): ReactNode {
  const config = TONES[tone] || TONES.neutral;
  const iconToRender = icon || config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset',
        config.badge,
        className,
      )}
    >
      <Icon name={iconToRender} className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
      <span>{children}</span>
    </span>
  );
}

/* ---------------------------------- cards --------------------------------- */

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}): ReactNode {
  return (
    <div id={id} className={cn('asterleaf-card p-5', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
      <div>
        <h2 className="text-base font-bold tracking-tight text-[#182944]">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  badge = 'DIGI',
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: string;
}): ReactNode {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-5">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-[#DDF4EC] px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-[#087F83] uppercase">
            {badge}
          </span>
          <span className="text-xs font-semibold text-slate-500">· 2026-27</span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[#182944] sm:text-3xl">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}): ReactNode {
  const config = TONES[tone] || TONES.info;
  return (
    <div
      role={tone === 'danger' || tone === 'rose' ? 'alert' : 'status'}
      className={cn('rounded-2xl p-4 text-sm ring-1 ring-inset', config.badge)}
    >
      <div className="flex items-start gap-2.5">
        <Icon name={config.icon} className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          {title && <p className="font-bold mb-0.5">{title}</p>}
          <div className="text-xs sm:text-sm leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = 'clipboard',
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  icon?: IconName;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#DDF4EC] text-[#087F83]">
        <Icon name={icon} className="h-6 w-6" strokeWidth={2} />
      </div>
      <h3 className="text-sm font-bold text-[#182944]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
        <Icon name="alert" className="h-5 w-5" />
      </div>
      <p className="text-sm font-bold text-[#182944]">Could not load this view</p>
      <p className="mt-1 max-w-md text-xs text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }): ReactNode {
  return (
    <div className="animate-pulse divide-y divide-slate-100" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div
              key={columnIndex}
              className={cn('h-4 rounded-xl bg-slate-100', columnIndex === 0 ? 'w-1/3' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- stat card ------------------------------ */

export const STAT_PALETTES = [
  // 0: Mint success (Blueprint card 1)
  {
    bg: 'bg-[#DDF4EC]',
    text: 'text-[#087F83]',
    border: 'border-[#087F83]/20',
    chip: 'bg-white/80 text-[#087F83]',
    indicator: 'bg-[#087F83]',
  },
  // 1: Lagoon / Sky tint (Blueprint card 2)
  {
    bg: 'bg-[#E6F4F5]',
    text: 'text-[#087F83]',
    border: 'border-[#087F83]/20',
    chip: 'bg-white/80 text-[#087F83]',
    indicator: 'bg-[#087F83]',
  },
  // 2: Amber review (Blueprint card 3)
  {
    bg: 'bg-[#FEF6E9]',
    text: 'text-[#B47408]',
    border: 'border-[#F6B84B]/30',
    chip: 'bg-white/80 text-[#B47408]',
    indicator: 'bg-[#F6B84B]',
  },
  // 3: Orchid learning (Blueprint card 4)
  {
    bg: 'bg-[#F3EFFC]',
    text: 'text-[#5A3AA8]',
    border: 'border-[#7654C7]/30',
    chip: 'bg-white/80 text-[#5A3AA8]',
    indicator: 'bg-[#7654C7]',
  },
] as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  color = 0,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  color?: number;
  tone?: string;
}): ReactNode {
  // Map tone string if provided
  let paletteIdx = color % STAT_PALETTES.length;
  if (tone === 'mint' || tone === 'success' || tone === 'emerald') paletteIdx = 0;
  else if (tone === 'lagoon' || tone === 'info' || tone === 'sky') paletteIdx = 1;
  else if (tone === 'amber' || tone === 'warning' || tone === 'yellow') paletteIdx = 2;
  else if (tone === 'orchid' || tone === 'learning') paletteIdx = 3;

  const palette = STAT_PALETTES[paletteIdx]!;

  return (
    <div
      className={cn(
        'rounded-2xl border p-5 shadow-xs transition hover:shadow-sm relative overflow-hidden',
        palette.bg,
        palette.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 truncate">
            {label}
          </p>
          <p className={cn('mt-2 text-3xl font-extrabold tracking-tight tabular-nums', palette.text)}>
            {value}
          </p>
          {hint && <p className="mt-1 text-xs font-medium text-slate-500 truncate">{hint}</p>}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-xs',
              palette.chip,
            )}
          >
            <Icon name={icon} className="h-5 w-5" strokeWidth={2.2} />
          </div>
        )}
      </div>
      <span className={cn('absolute inset-x-0 bottom-0 h-1', palette.indicator)} />
    </div>
  );
}

/* ----------------------------- operational panel --------------------------- */

export function BlueprintPanel({
  title,
  items,
  workspaceUrl,
  workspaceLabel = 'Open workspace >',
  className,
}: {
  title: string;
  items: Array<{
    label: string;
    subtext?: string;
    dotColor?: 'lagoon' | 'mint' | 'amber' | 'orchid';
    statusText?: string;
  }>;
  workspaceUrl?: string;
  workspaceLabel?: string;
  className?: string;
}): ReactNode {
  const dotColors = {
    lagoon: 'bg-[#087F83]',
    mint: 'bg-[#10B981]',
    amber: 'bg-[#F6B84B]',
    orchid: 'bg-[#7654C7]',
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex flex-col justify-between',
        className,
      )}
    >
      <div>
        <h3 className="text-base font-bold text-[#182944] mb-3.5 pb-2 border-b border-slate-100">
          {title}
        </h3>
        <ul className="space-y-3">
          {items.map((item, idx) => {
            const dot = dotColors[item.dotColor || (idx % 2 === 0 ? 'lagoon' : 'amber')];
            return (
              <li key={idx} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
                  <span className="text-slate-800 font-medium truncate">{item.label}</span>
                </div>
                {item.statusText && (
                  <span className="text-xs font-semibold text-slate-500 shrink-0 ml-2">
                    {item.statusText}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {workspaceUrl && (
        <div className="mt-5 pt-3 border-t border-slate-100">
          <a
            href={workspaceUrl}
            className="text-xs font-bold text-[#087F83] hover:underline flex items-center gap-1 group"
          >
            <span>{workspaceLabel}</span>
            <Icon
              name="arrowRight"
              className="h-3.5 w-3.5 transition group-hover:translate-x-1"
            />
          </a>
        </div>
      )}
    </div>
  );
}

export function Marquee({
  items,
  className,
}: {
  items: string[];
  className?: string;
}): ReactNode {
  return (
    <div className={cn('overflow-hidden whitespace-nowrap', className)}>
      <div className="inline-flex animate-marquee gap-8">
        {items.concat(items).map((item, index) => (
          <span key={index} className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#087F83]" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkle({ className }: { className?: string }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn('h-4 w-4 shrink-0 text-[#087F83]', className)}
    >
      <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
    </svg>
  );
}

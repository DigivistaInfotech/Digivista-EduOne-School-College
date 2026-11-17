import type { ReactNode } from 'react';

export function AsterleafSymbol({
  className = 'h-8 w-8',
}: {
  className?: string;
}): ReactNode {
  return (
    <svg
      viewBox="0 0 100 90"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Rising Leaf above book spine */}
      <path
        d="M50 8 C44 20, 48 34, 52 42 C56 34, 66 22, 59 10 C56 5, 52 8, 50 8Z"
        fill="#087F83"
      />
      <path
        d="M51 15 C50 24, 51 34, 52 42"
        stroke="#DDF4EC"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Open Book: Left Page */}
      <path
        d="M48 48 C34 46, 20 48, 8 56 C7 68, 7 80, 8 82 C20 74, 34 72, 48 76 Z"
        stroke="#087F83"
        strokeWidth="4"
        strokeLinejoin="round"
        fill="#FFFFFF"
      />
      {/* Left Page Detail line */}
      <path
        d="M14 62 C24 57, 36 56, 44 58"
        stroke="#DDF4EC"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Open Book: Right Page */}
      <path
        d="M52 48 C66 46, 80 48, 92 56 C93 68, 93 80, 92 82 C80 74, 66 72, 52 76 Z"
        stroke="#087F83"
        strokeWidth="4"
        strokeLinejoin="round"
        fill="#FFFFFF"
      />
      {/* Right Page Detail line */}
      <path
        d="M86 62 C76 57, 64 56, 56 58"
        stroke="#DDF4EC"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Book Spine Center Accent */}
      <path
        d="M50 48 V78"
        stroke="#182944"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AsterleafBrand({
  inverted = false,
  showTagline = true,
}: {
  inverted?: boolean;
  showTagline?: boolean;
}): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 p-1 shadow-sm backdrop-blur">
        <AsterleafSymbol className="h-8 w-8" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`font-sans text-base font-extrabold tracking-tight ${
              inverted ? 'text-white' : 'text-[#182944]'
            }`}
          >
            DIGI
          </span>
          <span className="text-xs font-bold tracking-wider text-[#087F83] uppercase">
            Education
          </span>
        </div>
        {showTagline && (
          <p
            className={`text-[10px] font-semibold tracking-wider uppercase ${
              inverted ? 'text-white/60' : 'text-[#087F83]'
            }`}
          >
            Education Management Suite
          </p>
        )}
      </div>
    </div>
  );
}

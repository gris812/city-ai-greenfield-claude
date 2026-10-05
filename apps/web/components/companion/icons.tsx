/** Minimal stroke icon set (24px grid, currentColor). */
type P = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const IconMic = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const IconPause = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 5v14M15 5v14" />
  </svg>
);
export const IconPlay = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" />
  </svg>
);
export const IconSkip = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 5l9 7-9 7zM18 5v14" />
  </svg>
);
export const IconNotThis = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <path d="M7 17L17 7" />
  </svg>
);
export const IconClose = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconMenu = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const IconBug = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6h16M4 12h10M4 18h6" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);
export const IconClock = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);
export const IconGear = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
);
export const IconMap = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
  </svg>
);
export const IconLocate = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);
export const IconRoute = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />
  </svg>
);
export const IconLock = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconCheck = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);
export const IconAlert = ({ size = 16, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l10 18H2zM12 10v4M12 17.5v.5" />
  </svg>
);
export const IconKey = ({ size = 18, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M17 6l3 3" />
  </svg>
);

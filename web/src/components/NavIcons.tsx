type IconProps = { className?: string };

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Dashboard / Today */
export function IconHome({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        {...stroke}
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
      />
    </svg>
  );
}

/** @deprecated use IconHome */
export const IconToday = IconHome;

export function IconLog({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M12 8v8M8 12h8" {...stroke} />
    </svg>
  );
}

/** Food library */
export function IconLibrary({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M5 19.5A2.5 2.5 0 0 1 7.5 17H20" />
      <path {...stroke} d="M7.5 3H20v18H7.5A2.5 2.5 0 0 1 5 18.5v-13A2.5 2.5 0 0 1 7.5 3Z" />
    </svg>
  );
}

export function IconPlan({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M8 2v4M16 2v4M4 9h16" />
      <path {...stroke} d="M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function IconFamily({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="2.5" fill="currentColor" />
      <circle cx="16" cy="10" r="2" fill="currentColor" />
      <path d="M4 18c0-2.5 2.2-4 5-4s5 1.5 5 4" {...stroke} />
      <path d="M14 17c0-1.8 1.4-3 3-3" {...stroke} />
    </svg>
  );
}

/** Settings / preferences */
export function IconSettings({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        {...stroke}
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
      />
      <path
        {...stroke}
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
      />
    </svg>
  );
}

export function IconSignIn({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" {...stroke} />
      <path d="M3 12h11m0 0-3-3m3 3-3 3" {...stroke} />
    </svg>
  );
}

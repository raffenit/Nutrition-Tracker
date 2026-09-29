type HelixMarkProps = {
  size?: number;
};

export function HelixMark({ size = 36 }: HelixMarkProps) {
  return (
    <svg className="helix" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 6C46 11 46 17 32 22C18 27 18 33 32 38C46 43 46 49 32 58" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M32 6C18 11 18 17 32 22C46 27 46 33 32 38C18 43 18 49 32 58" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

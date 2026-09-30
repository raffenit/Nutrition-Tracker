type Props = {
  active: boolean;
  onToggle: () => void;
  label?: string;
};

export function FavoriteStar({ active, onToggle, label }: Props) {
  const aria = label ?? (active ? 'Remove from favorites' : 'Add to favorites');
  return (
    <button
      type="button"
      className={`favorite-star${active ? ' is-active' : ''}`}
      aria-label={aria}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 2.5l2.55 5.18 5.7.83-4.12 4.02.97 5.67L12 15.9l-5.1 2.68.97-5.67-4.12-4.02 5.7-.83L12 2.5z"
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

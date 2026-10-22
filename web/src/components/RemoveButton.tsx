import { IconTrash } from './NavIcons';

type RemoveButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
};

export function RemoveButton({ label, onClick, className, disabled = false }: RemoveButtonProps) {
  return (
    <button
      type="button"
      className={className ? `remove-icon-btn ${className}` : 'remove-icon-btn'}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <IconTrash className="remove-icon-btn-icon" />
    </button>
  );
}

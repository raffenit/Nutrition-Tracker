import { navigate } from '../nav';

export function LogFab() {
  return (
    <button
      type="button"
      className="fab"
      aria-label="Log food or drink"
      onClick={() => navigate('/add')}
    >
      +
    </button>
  );
}

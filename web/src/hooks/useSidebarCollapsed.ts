import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nutrition-tracker:sidebar-collapsed';

/** Desktop sidebar visible, but viewport is roughly half-screen (two-up windows). */
export const SIDEBAR_AUTO_COMPACT_QUERY = '(min-width: 900px) and (max-width: 1199px)';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function readAutoCompact(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(SIDEBAR_AUTO_COMPACT_QUERY).matches;
}

export type SidebarCollapseState = {
  collapsed: boolean;
  canToggle: boolean;
  toggle: () => void;
};

export function useSidebarCollapsed(): SidebarCollapseState {
  const [userCollapsed, setUserCollapsed] = useState(() => readCollapsed());
  const [autoCompact, setAutoCompact] = useState(() => readAutoCompact());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, userCollapsed ? '1' : '0');
    } catch {
      /* private mode / blocked storage */
    }
  }, [userCollapsed]);

  useEffect(() => {
    const media = window.matchMedia(SIDEBAR_AUTO_COMPACT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setAutoCompact(event.matches);
    setAutoCompact(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return {
    collapsed: autoCompact || userCollapsed,
    canToggle: !autoCompact,
    toggle: () => setUserCollapsed((value) => !value),
  };
}

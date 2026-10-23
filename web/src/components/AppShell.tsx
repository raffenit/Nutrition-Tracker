import type { ReactNode } from 'react';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed';
import { navigate } from '../nav';
import { HelixMark } from './HelixMark';
import {
  IconFamily,
  IconHome,
  IconLibrary,
  IconPlan,
  IconSettings,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconSignIn,
} from './NavIcons';
import { OfflineBanner } from './OfflineBanner';

const LINKS = [
  { href: '/', label: 'Home', Icon: IconHome },
  { href: '/plan', label: 'Plan', Icon: IconPlan },
  { href: '/library', label: 'Library', Icon: IconLibrary },
  { href: '/family', label: 'Family', Icon: IconFamily },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
] as const;

type AppShellProps = { path: string; kiosk: boolean; children: ReactNode };

export function AppShell({ path, kiosk, children }: AppShellProps) {
  const links = kiosk ? [] : LINKS;
  const { offline, pendingCount } = useOfflineStatus();
  const sidebar = useSidebarCollapsed();
  const appClass = sidebar.collapsed && !kiosk ? 'app sidebar-collapsed' : 'app';

  return (
    <div className={appClass}>
      {!kiosk && links.length > 0 && (
        <aside className="app-sidebar" aria-label="Primary">
          <nav className="app-nav" id="app-main-nav" aria-label="Main">
            {links.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className="tab"
                aria-current={path === href ? 'page' : undefined}
                aria-label={label}
                title={label}
                onClick={(event) => { event.preventDefault(); navigate(href); }}
              >
                <Icon className="tab-icon" />
                <span className="tab-label">{label}</span>
              </a>
            ))}
          </nav>
          {sidebar.canToggle && (
            <button
              type="button"
              className="sidebar-collapse-toggle"
              aria-expanded={!sidebar.collapsed}
              aria-controls="app-main-nav"
              aria-label={sidebar.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={sidebar.toggle}
            >
              {sidebar.collapsed ? (
                <IconSidebarExpand className="sidebar-collapse-toggle-icon" />
              ) : (
                <IconSidebarCollapse className="sidebar-collapse-toggle-icon" />
              )}
              <span className="sidebar-collapse-toggle-label">
                {sidebar.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </span>
            </button>
          )}
        </aside>
      )}
      <div className="app-frame">
        {!kiosk && <OfflineBanner offline={offline} pendingCount={pendingCount} />}
        <header className="top app-brand-bar">
          <button type="button" className="brand" aria-label="Nutrition Tracker home" onClick={() => navigate('/')}>
            <span className="brand-word">Nutrition</span>
            <HelixMark className="brand-helix" size={32} />
            <span className="brand-word">Tracker</span>
          </button>
        </header>
        <main className="main">{children}</main>
      </div>
      {kiosk && (
        <nav className="tabbar kiosk-bar app-nav" aria-label="Kiosk">
          <a href="/login" className="tab" aria-label="Sign in" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>
            <IconSignIn className="tab-icon" />
            <span className="tab-label">Sign in</span>
          </a>
        </nav>
      )}
    </div>
  );
}

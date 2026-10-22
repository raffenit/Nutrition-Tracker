import type { ReactNode } from 'react';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { navigate } from '../nav';
import { HelixMark } from './HelixMark';
import { IconFamily, IconHome, IconLibrary, IconPlan, IconSettings, IconSignIn } from './NavIcons';
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
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="brand" aria-label="Nutrition Tracker home" onClick={() => navigate('/')}>
          <span className="brand-word">Nutrition</span>
          <HelixMark size={28} />
          <span className="brand-word">Tracker</span>
        </button>
      </header>
      {!kiosk && <OfflineBanner offline={offline} pendingCount={pendingCount} />}
      {links.length > 0 && (
        <nav className="tabbar app-nav" aria-label="Main">
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
      )}
      <main className="main">{children}</main>
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

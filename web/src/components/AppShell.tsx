import type { ReactNode } from 'react';
import { navigate } from '../nav';
import { HelixMark } from './HelixMark';
import { IconFamily, IconHome, IconLibrary, IconPlan, IconSettings, IconSignIn } from './NavIcons';

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
  return (
    <div className="app">
      <header className="top">
        <button type="button" className="brand" aria-label="Nutrition Tracker home" onClick={() => navigate('/')}>
          <span className="brand-word">Nutrition</span>
          <HelixMark size={28} />
          <span className="brand-word">Tracker</span>
        </button>
      </header>
      <main className="main">{children}</main>
      {links.length > 0 && (
        <nav className="tabbar" aria-label="Main">
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
            </a>
          ))}
        </nav>
      )}
      {kiosk && (
        <nav className="tabbar kiosk-bar" aria-label="Kiosk">
          <a href="/login" className="tab" aria-label="Sign in" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>
            <IconSignIn className="tab-icon" />
          </a>
        </nav>
      )}
    </div>
  );
}

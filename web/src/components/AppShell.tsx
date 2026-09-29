import type { ReactNode } from 'react';
import { navigate } from '../nav';
import { HelixMark } from './HelixMark';

const LINKS = [
  ['/', 'Today'],
  ['/add', 'Log'],
  ['/library', 'Library'],
  ['/family', 'Family'],
  ['/settings', 'Settings'],
] as const;

type AppShellProps = { path: string; kiosk: boolean; children: ReactNode };

export function AppShell({ path, kiosk, children }: AppShellProps) {
  const links = kiosk ? [] : LINKS;
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><HelixMark /><span>Nutrition</span></div>
        <nav className="nav">
          {links.map(([href, label]) => (
            <a key={href} href={href} aria-current={path === href ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(href); }}>{label}</a>
          ))}
          {kiosk && <a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>Sign in</a>}
        </nav>
      </header>
      {children}
    </div>
  );
}

import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { APP_NAME, APP_VERSION, POWERED_BY } from '@pothole/shared';
import { useAuth, useMe } from '../auth/auth';
import { Avatar, Chip } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: '▦', end: true },
  { to: '/approvals', label: 'Approvals', icon: '✓' },
  { to: '/review', label: 'Review Queue', icon: '☰' },
  { to: '/samples', label: 'Samples', icon: '▤' },
  { to: '/settlements', label: 'Settlements', icon: '₹' },
  { to: '/exports', label: 'Exports', icon: '⇩' },
] as const;

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/approvals': 'Approvals',
  '/review': 'Review Queue',
  '/samples': 'Samples',
  '/settlements': 'Settlements',
  '/exports': 'Exports',
};

export function Layout() {
  const { identity, logout, devMode } = useAuth();
  const { me } = useMe();
  const location = useLocation();
  const title =
    TITLES[
      '/' + (location.pathname.split('/')[1] || '')
    ] || APP_NAME;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-mark">🕳️</span>
          <div>
            <div className="logo-title">{APP_NAME}</div>
            <div className="logo-sub">Admin</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item && item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="muted small">Powered by {POWERED_BY}</div>
          <div className="muted small">v{APP_VERSION}</div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <h2 className="topbar-title">{title}</h2>
          <div className="topbar-right">
            {devMode ? <Chip tone="warn">DEV BYPASS</Chip> : null}
            <Chip tone={me.role === 'owner' ? 'accent' : 'info'}>{me.role}</Chip>
            <div className="identity">
              <Avatar url={identity?.picture ?? me.photoUrl} name={identity?.name || me.fullName} />
              <div className="identity-text">
                <div className="identity-name">{identity?.name || me.fullName}</div>
                <div className="muted small">{identity?.email || me.email}</div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              {devMode ? 'Reload' : 'Log out'}
            </button>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

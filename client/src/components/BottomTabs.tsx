import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** Phone-only navigation (hidden on wide screens via CSS). */
export default function BottomTabs() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;

  const tabs =
    user.role === 'driver'
      ? [
          { to: '/drive', icon: '🚗', label: 'Drive' },
          { to: '/drive/earnings', icon: '💰', label: 'Earnings' },
          { to: '/drive/vehicle', icon: '🪪', label: 'Vehicle' },
        ]
      : [
          { to: '/ride', icon: '📍', label: 'Ride' },
          { to: '/trips', icon: '🧾', label: 'Trips' },
        ];

  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'on' : '')}>
          <span className="tab-icon" aria-hidden>
            {t.icon}
          </span>
          {t.label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={() => {
          logout();
          nav('/');
        }}
      >
        <span className="tab-icon" aria-hidden>
          🚪
        </span>
        Log out
      </button>
    </nav>
  );
}

import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** Phone-only navigation (hidden on wide screens via CSS). */
export default function BottomTabs() {
  const { user } = useAuth();
  if (!user) return null;

  const tabs =
    user.role === 'driver'
      ? [
          { to: '/drive', icon: '🚗', label: 'Drive' },
          { to: '/drive/earnings', icon: '📈', label: 'Earnings' },
          { to: '/wallet', icon: '💰', label: 'Wallet' },
          { to: '/drive/documents', icon: '🪪', label: 'Docs' },
        ]
      : [
          { to: '/ride', icon: '📍', label: 'Ride' },
          { to: '/trips', icon: '🧾', label: 'Trips' },
          { to: '/wallet', icon: '💰', label: 'Wallet' },
          { to: '/safety', icon: '🛡️', label: 'Safety' },
        ];

  if (user.is_admin) tabs.push({ to: '/admin', icon: '⚙️', label: 'Admin' });

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
    </nav>
  );
}

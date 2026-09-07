import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { APP_NAME } from '../lib/brand';

export default function TopNav() {
  const { user, logout, offline } = useAuth();
  const nav = useNavigate();
  return (
    <header className="topnav">
      <Link to={user ? (user.role === 'driver' ? '/drive' : '/ride') : '/'} className="brand">
        {APP_NAME}
      </Link>
      <nav className="topnav-links">
        {user?.role === 'customer' && (
          <>
            <NavLink to="/ride">Ride</NavLink>
            <NavLink to="/trips">My trips</NavLink>
            <NavLink to="/wallet">Wallet</NavLink>
            <NavLink to="/safety">Safety</NavLink>
          </>
        )}
        {user?.role === 'driver' && (
          <>
            <NavLink to="/drive">Drive</NavLink>
            <NavLink to="/drive/earnings">Earnings</NavLink>
            <NavLink to="/wallet">Wallet</NavLink>
            <NavLink to="/drive/documents">Documents</NavLink>
            <NavLink to="/drive/vehicle">Vehicle</NavLink>
          </>
        )}
        {user?.is_admin ? <NavLink to="/admin">Admin</NavLink> : null}
        {!user && (
          <>
            <NavLink to="/ride">Ride</NavLink>
            <NavLink to="/signup?role=driver">Drive</NavLink>
          </>
        )}
      </nav>
      <div className="topnav-right">
        {offline && <span className="offline-dot" title="Cannot reach the server; showing your saved session">offline</span>}
        {user ? (
          <>
            <span className="topnav-user">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="topnav-name">{user.name}</span>
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                logout();
                nav('/');
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-ghost btn-sm" to="/login">
              Log in
            </Link>
            <Link className="btn btn-light btn-sm" to="/signup">
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

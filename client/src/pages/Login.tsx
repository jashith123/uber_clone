import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError, apiBase, isNativeApp, setApiBase } from '../lib/api';
import type { Role } from '../lib/types';
import DemoAccounts from '../components/DemoAccounts';

const ROLE_KEY = 'swiftride.loginRole';

function initialRole(param: string | null): Role {
  if (param === 'driver' || param === 'customer') return param;
  try {
    const saved = localStorage.getItem(ROLE_KEY);
    if (saved === 'driver' || saved === 'customer') return saved;
  } catch {
    /* ignore */
  }
  return 'customer';
}

const roleWord = (r: Role) => (r === 'driver' ? 'driver' : 'rider');

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const [role, setRole] = useState<Role>(() => initialRole(params.get('role') || (next?.startsWith('/drive') ? 'driver' : null)));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set when the credentials belong to the other kind of account, so one tap
  // can switch the tab and log in instead of retyping everything.
  const [switchTo, setSwitchTo] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(isNativeApp());
  const [server, setServer] = useState(apiBase());

  async function doLogin(asRole: Role) {
    setBusy(true);
    setError(null);
    setSwitchTo(null);
    try {
      if (isNativeApp()) setApiBase(server);
      try {
        localStorage.setItem(ROLE_KEY, asRole);
      } catch {
        /* ignore */
      }
      const user = await login(email, password, asRole);
      const home = user.role === 'driver' ? '/drive' : '/ride';
      // Only follow "next" if it is a path on this account's side of the app.
      const safeNext = next && /^\/[^/\\]/.test(next) ? next : null;
      const allowed = safeNext && (user.role === 'driver' ? safeNext.startsWith('/drive') : !safeNext.startsWith('/drive'));
      nav(allowed ? safeNext : home, { replace: true });
    } catch (err) {
      const e = err as ApiError;
      const actual = e.data?.role;
      setSwitchTo(actual === 'driver' || actual === 'customer' ? (actual as Role) : null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void doLogin(role);
  }

  function pick(r: Role) {
    setRole(r);
    setError(null);
    setSwitchTo(null);
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Welcome back</h1>
        <div className="segmented">
          <button type="button" className={role === 'customer' ? 'on' : ''} onClick={() => pick('customer')}>
            I'm a rider
          </button>
          <button type="button" className={role === 'driver' ? 'on' : ''} onClick={() => pick('driver')}>
            I'm a driver
          </button>
        </div>
        <p className="muted">{role === 'driver' ? 'Log in with your driver account.' : 'Log in with your rider account.'}</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {isNativeApp() && (showServer ? (
          <label>
            Server address
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://192.168.29.217:4000 or https://xxx.loca.lt" inputMode="url" />
            <small className="muted">The PC running &quot;npm run serve&quot;, or the tunnel address.</small>
          </label>
        ) : (
          <button type="button" className="link" onClick={() => setShowServer(true)}>
            Advanced: change server address
          </button>
        ))}
        {error && (
          <div className="error">
            {error}
            {switchTo && (
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-light btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setRole(switchTo);
                    void doLogin(switchTo);
                  }}
                >
                  Switch to &quot;I'm a {roleWord(switchTo)}&quot; and log in
                </button>
              </div>
            )}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : role === 'driver' ? 'Log in to drive' : 'Log in to ride'}
        </button>
        <p className="muted">
          New here? <Link to={`/signup?role=${role}`}>Create a {roleWord(role)} account</Link>
        </p>
        <DemoAccounts
          role={role}
          onUse={(a) => {
            setEmail(a.email);
            setPassword(a.password);
          }}
        />
      </form>
    </main>
  );
}

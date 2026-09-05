import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      nav(params.get('next') || (user.role === 'driver' ? '/drive' : '/ride'), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Welcome back</h1>
        <p className="muted">Log in to ride or drive.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted">
          New here? <Link to="/signup">Create an account</Link>
        </p>
        <div className="demo-box">
          <strong>Demo accounts</strong>
          <button type="button" className="link" onClick={() => { setEmail('customer@demo.com'); setPassword('password'); }}>
            customer@demo.com / password
          </button>
          <button type="button" className="link" onClick={() => { setEmail('driver@demo.com'); setPassword('password'); }}>
            driver@demo.com / password (Go)
          </button>
          <button type="button" className="link" onClick={() => { setEmail('driver2@demo.com'); setPassword('password'); }}>
            driver2@demo.com / password (Comfort)
          </button>
        </div>
      </form>
    </main>
  );
}

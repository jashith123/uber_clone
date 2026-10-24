import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type Step = 'phone' | 'code' | 'password' | 'done';

/**
 * Password reset by phone: ask for a code, type it, choose a new password.
 * In demo mode the server hands the code back so it can be tested without an
 * SMS account; a real provider only sends it by SMS.
 */
export default function ForgotPassword() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      {step === 'phone' && (
        <form className="auth-card" onSubmit={(e) => run(e, async () => {
          const r = await api<{ demo_code?: string }>('/auth/otp/send', { method: 'POST', body: { phone, purpose: 'reset' } });
          setDemoCode(r.demo_code ?? null);
          setStep('code');
        })}>
          <h1>Reset your password</h1>
          <p className="muted">We send a 6-digit code to the mobile number on your account.</p>
          <label>
            Mobile number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" required autoFocus />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          <p className="muted"><Link to="/login">Back to log in</Link></p>
        </form>
      )}

      {step === 'code' && (
        <form className="auth-card" onSubmit={(e) => run(e, async () => {
          const r = await api<{ otp_token: string }>('/auth/otp/verify', { method: 'POST', body: { phone, code, purpose: 'reset' } });
          setOtpToken(r.otp_token);
          setStep('password');
        })}>
          <h1>Enter the code</h1>
          <p className="muted">Sent to {phone}. It expires in 10 minutes.</p>
          {demoCode && <div className="ok">Demo mode: your code is <b>{demoCode}</b>. With an SMS provider configured it arrives by SMS instead.</div>}
          <label>
            6-digit code
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} required autoFocus />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</button>
          <p className="muted"><button type="button" className="link" onClick={() => setStep('phone')}>Use a different number</button></p>
        </form>
      )}

      {step === 'password' && (
        <form className="auth-card" onSubmit={(e) => run(e, async () => {
          await api('/auth/reset', { method: 'POST', body: { otp_token: otpToken, password } });
          setStep('done');
        })}>
          <h1>Choose a new password</h1>
          <label>
            New password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoFocus autoComplete="new-password" />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      )}

      {step === 'done' && (
        <div className="auth-card">
          <h1>Password changed</h1>
          <p className="muted">Log in with your new password.</p>
          <button className="btn btn-primary btn-block" onClick={() => nav('/login')}>Log in</button>
        </div>
      )}
    </main>
  );
}

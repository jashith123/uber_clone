import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Pricing, Role } from '../lib/types';

type PhoneStep = 'enter' | 'code' | 'verified';

export default function Signup() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get('role') === 'driver' ? 'driver' : 'customer');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [vehicle, setVehicle] = useState({ vehicle_type: 'economy', make: '', model: '', color: '', plate: '' });
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Phone verification: the server only creates the account for a number that
  // received a code. In demo mode the code is handed back and shown here.
  const [needOtp, setNeedOtp] = useState(true);
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  useEffect(() => {
    api<{ pricing: Pricing[] }>('/geo/pricing').then((r) => setPricing(r.pricing)).catch(() => {});
    api<{ phone_otp?: boolean }>('/auth/demo').then((r) => setNeedOtp(r.phone_otp !== false)).catch(() => {});
  }, []);

  async function sendCode() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const r = await api<{ demo_code?: string }>('/auth/otp/send', { method: 'POST', body: { phone: form.phone, purpose: 'signup' } });
      setDemoCode(r.demo_code ?? null);
      setCode('');
      setPhoneStep('code');
    } catch (err) {
      setOtpError((err as Error).message);
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyCode() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const r = await api<{ otp_token: string; phone: string }>('/auth/otp/verify', { method: 'POST', body: { phone: form.phone, code, purpose: 'signup' } });
      setOtpToken(r.otp_token);
      setForm((f) => ({ ...f, phone: r.phone }));
      setPhoneStep('verified');
    } catch (err) {
      setOtpError((err as Error).message);
    } finally {
      setOtpBusy(false);
    }
  }

  function changePhone(value: string) {
    setForm({ ...form, phone: value });
    if (phoneStep !== 'enter') {
      setPhoneStep('enter');
      setOtpToken(null);
      setDemoCode(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (needOtp && !otpToken) {
      setError('Verify your mobile number first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, role, otp_token: otpToken ?? undefined, vehicle: role === 'driver' ? vehicle : undefined });
      nav(role === 'driver' ? '/drive' : '/ride', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const setV = (k: keyof typeof vehicle) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setVehicle({ ...vehicle, [k]: e.target.value });

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <div className="segmented">
          <button type="button" className={role === 'customer' ? 'on' : ''} onClick={() => setRole('customer')}>
            I want to ride
          </button>
          <button type="button" className={role === 'driver' ? 'on' : ''} onClick={() => setRole('driver')}>
            I want to drive
          </button>
        </div>
        <label>
          Full name
          <input value={form.name} onChange={set('name')} required autoFocus />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>

        <label>
          Mobile number {phoneStep === 'verified' && <span className="tag tag-ok">verified</span>}
          <div className="row-inline">
            <input
              value={form.phone}
              onChange={(e) => changePhone(e.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              required
              readOnly={phoneStep === 'verified'}
            />
            {needOtp && phoneStep !== 'verified' && (
              <button type="button" className="btn btn-light btn-sm" disabled={otpBusy || form.phone.replace(/\D/g, '').length < 10} onClick={sendCode}>
                {otpBusy && phoneStep === 'enter' ? 'Sending…' : phoneStep === 'code' ? 'Resend' : 'Send code'}
              </button>
            )}
          </div>
        </label>
        {needOtp && phoneStep === 'code' && (
          <div className="otp-box">
            {demoCode ? (
              <p className="ok">Demo mode: your code is <b>{demoCode}</b>. With an SMS provider configured it arrives by SMS instead.</p>
            ) : (
              <p className="muted">We sent a 6-digit code to {form.phone}. It expires in 10 minutes.</p>
            )}
            <div className="row-inline">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                autoFocus
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={otpBusy || code.length !== 6} onClick={verifyCode}>
                {otpBusy ? 'Checking…' : 'Verify'}
              </button>
            </div>
          </div>
        )}
        {otpError && <div className="error">{otpError}</div>}

        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} minLength={6} required autoComplete="new-password" />
        </label>

        {role === 'driver' && (
          <fieldset className="vehicle-fields">
            <legend>Your vehicle</legend>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
              Riders are matched to your vehicle class and look for this exact car, so every field is needed.
            </p>
            <label>
              Class
              <select value={vehicle.vehicle_type} onChange={setV('vehicle_type')}>
                {(pricing.length ? pricing : [{ vehicle_type: 'economy', label: 'Go', description: '' } as Pricing]).map((p) => (
                  <option key={p.vehicle_type} value={p.vehicle_type}>
                    {p.label} — {p.description}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-2">
              <label>
                Make
                <input value={vehicle.make} onChange={setV('make')} placeholder="Maruti" required />
              </label>
              <label>
                Model
                <input value={vehicle.model} onChange={setV('model')} placeholder="Swift" required />
              </label>
              <label>
                Colour
                <input value={vehicle.color} onChange={setV('color')} placeholder="White" required />
              </label>
              <label>
                Plate
                <input value={vehicle.plate} onChange={setV('plate')} placeholder="DL 01 AB 1234" required />
              </label>
            </div>
          </fieldset>
        )}

        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || (needOtp && phoneStep !== 'verified')}>
          {busy ? 'Creating…' : role === 'driver' ? 'Start driving' : 'Start riding'}
        </button>
        <p className="muted">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}

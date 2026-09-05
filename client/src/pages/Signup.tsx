import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Pricing, Role } from '../lib/types';

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

  useEffect(() => {
    api<{ pricing: Pricing[] }>('/geo/pricing').then((r) => setPricing(r.pricing)).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, role, vehicle: role === 'driver' ? vehicle : undefined });
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
          Phone
          <input value={form.phone} onChange={set('phone')} placeholder="+91 …" />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} minLength={6} required />
        </label>

        {role === 'driver' && (
          <fieldset className="vehicle-fields">
            <legend>Your vehicle</legend>
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
                <input value={vehicle.make} onChange={setV('make')} placeholder="Maruti" />
              </label>
              <label>
                Model
                <input value={vehicle.model} onChange={setV('model')} placeholder="Swift" />
              </label>
              <label>
                Colour
                <input value={vehicle.color} onChange={setV('color')} placeholder="White" />
              </label>
              <label>
                Plate
                <input value={vehicle.plate} onChange={setV('plate')} placeholder="DL 01 AB 1234" />
              </label>
            </div>
          </fieldset>
        )}

        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating…' : role === 'driver' ? 'Start driving' : 'Start riding'}
        </button>
        <p className="muted">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}

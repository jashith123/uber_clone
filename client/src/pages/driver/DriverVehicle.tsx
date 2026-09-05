import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { getSocket } from '../../lib/socket';
import { money } from '../../lib/format';
import type { Pricing, User } from '../../lib/types';

export default function DriverVehicle() {
  const { user, setUser } = useAuth();
  const d = user?.driver;
  const [form, setForm] = useState({
    vehicle_type: d?.vehicle_type ?? 'economy',
    make: d?.vehicle_make ?? '',
    model: d?.vehicle_model ?? '',
    color: d?.vehicle_color ?? '',
    plate: d?.plate ?? '',
  });
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<{ pricing: Pricing[] }>('/geo/pricing').then((r) => setPricing(r.pricing)).catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const { user: u } = await api<{ user: User }>('/drivers/me', { method: 'PUT', body: form });
      setUser(u);
      getSocket()?.emit('driver:rejoin');
      setMsg('Saved.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const tariff = pricing.find((p) => p.vehicle_type === form.vehicle_type);

  return (
    <main className="page narrow">
      <h1>Your vehicle</h1>
      <form className="card form" onSubmit={submit}>
        <label>
          Class
          <select value={form.vehicle_type} onChange={set('vehicle_type')}>
            {pricing.map((p) => (
              <option key={p.vehicle_type} value={p.vehicle_type}>
                {p.label} — {p.description}
              </option>
            ))}
          </select>
        </label>
        {tariff && (
          <p className="muted">
            Tariff: {money(tariff.base_fare, tariff.currency)} base · {money(tariff.per_km, tariff.currency)}/km · {money(tariff.per_min, tariff.currency)}/min · min{' '}
            {money(tariff.min_fare, tariff.currency)}
          </p>
        )}
        <div className="grid-2">
          <label>
            Make
            <input value={form.make} onChange={set('make')} />
          </label>
          <label>
            Model
            <input value={form.model} onChange={set('model')} />
          </label>
          <label>
            Colour
            <input value={form.color} onChange={set('color')} />
          </label>
          <label>
            Plate
            <input value={form.plate} onChange={set('plate')} />
          </label>
        </div>
        {msg && <div className={msg === 'Saved.' ? 'ok' : 'error'}>{msg}</div>}
        <button className="btn btn-primary">Save</button>
      </form>
    </main>
  );
}

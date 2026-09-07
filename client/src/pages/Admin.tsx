import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { STATUS_LABEL, formatDate, km, money, signedClass, timeAgo } from '../lib/format';
import type { AdminStats, AdminUser, Pricing, Promo, Ride, SosAlert, SurgeZone } from '../lib/types';

type Tab = 'overview' | 'rides' | 'users' | 'drivers' | 'fares' | 'promos' | 'surge' | 'safety';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'rides', label: 'Rides' },
  { id: 'users', label: 'Users' },
  { id: 'drivers', label: 'Driver approval' },
  { id: 'fares', label: 'Fares' },
  { id: 'promos', label: 'Promo codes' },
  { id: 'surge', label: 'Surge' },
  { id: 'safety', label: 'SOS' },
];

interface PendingDriver {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  vehicle_type: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  plate: string | null;
  approval_status: string;
  documents: { id: number; kind: string; status: string; number: string | null }[];
}

export default function Admin() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    api<AdminStats>('/admin/stats').then(setStats).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    loadStats();
    const t = window.setInterval(loadStats, 15000);
    const s = getSocket();
    s?.on('admin:ride', loadStats);
    s?.on('sos:new', loadStats);
    return () => {
      window.clearInterval(t);
      s?.off('admin:ride', loadStats);
      s?.off('sos:new', loadStats);
    };
  }, [loadStats]);

  return (
    <main className="page admin">
      <h1>Admin</h1>
      {error && <div className="error">{error}</div>}

      <nav className="tab-row">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'drivers' && stats?.pending_approvals ? <span className="pill">{stats.pending_approvals}</span> : null}
            {t.id === 'safety' && stats?.open_sos ? <span className="pill pill-red">{stats.open_sos}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview stats={stats} />}
      {tab === 'rides' && <Rides />}
      {tab === 'users' && <Users />}
      {tab === 'drivers' && <Drivers onChange={loadStats} />}
      {tab === 'fares' && <Fares />}
      {tab === 'promos' && <Promos />}
      {tab === 'surge' && <Surge />}
      {tab === 'safety' && <Safety onChange={loadStats} />}
    </main>
  );
}

function Overview({ stats }: { stats: AdminStats | null }) {
  if (!stats) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="stat-row">
        <Stat label="Rides today" value={String(stats.today.rides)} sub={`${money(stats.today.gross)} · ${km(stats.today.km)}`} />
        <Stat label="Active right now" value={String(stats.rides.active)} sub={`${stats.drivers_online} drivers online`} />
        <Stat label="Platform commission" value={money(stats.commission)} sub="from cash rides" />
      </div>
      <div className="stat-row">
        <Stat label="Riders" value={String(stats.users.riders)} sub={`${stats.users.blocked} blocked`} />
        <Stat label="Drivers" value={String(stats.users.drivers)} sub={`${stats.pending_approvals} awaiting approval`} />
        <Stat label="All rides" value={String(stats.rides.total)} sub={`${stats.rides.completed} done · ${stats.rides.cancelled} cancelled`} />
      </div>
      <div className="stat-row">
        <Stat label="Gross fares" value={money(stats.revenue.gross_fares)} sub="completed trips" />
        <Stat label="Cancellation fees" value={money(stats.revenue.cancel_fees)} sub="charged to riders" />
        <Stat label="Open SOS" value={String(stats.open_sos)} sub={stats.open_sos ? 'needs attention' : 'all clear'} />
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card stat">
      <small>{label}</small>
      <strong>{value}</strong>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function Rides() {
  const [rides, setRides] = useState<(Ride & { customer_name: string; driver_name: string | null })[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    api<{ rides: (Ride & { customer_name: string; driver_name: string | null })[] }>(`/admin/rides${status ? `?status=${status}` : ''}`)
      .then((r) => setRides(r.rides))
      .catch(() => {});
  }, [status]);

  return (
    <>
      <div className="chip-row">
        {['', 'requested', 'accepted', 'in_progress', 'completed', 'cancelled'].map((s) => (
          <button key={s || 'all'} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
            {s ? STATUS_LABEL[s] : 'All'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th><th>Status</th><th>Rider</th><th>Driver</th><th>Route</th><th>Km</th><th>Fare</th><th>Pay</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {rides.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td><span className={`status-badge status-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td>{r.customer_name}</td>
                <td>{r.driver_name || '—'}</td>
                <td className="ellipsis">{(r.pickup_address || '').split(',')[0]} → {(r.dropoff_address || '').split(',')[0]}</td>
                <td>{r.distance_km?.toFixed(1)}</td>
                <td>
                  {money(r.fare_final ?? r.fare_estimate)}
                  {r.surge_multiplier > 1 ? <span className="tag">×{r.surge_multiplier}</span> : null}
                  {r.discount > 0 ? <span className="tag tag-green">-{money(r.discount)}</span> : null}
                </td>
                <td>{r.payment_method}{r.payment_status === 'failed' ? ' ⚠' : ''}</td>
                <td>{timeAgo(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`).then((r) => setUsers(r.users)).catch(() => {});
  }, [q]);
  useEffect(() => {
    const t = window.setTimeout(load, 250);
    return () => window.clearTimeout(t);
  }, [load]);

  async function block(u: AdminUser) {
    await api(`/admin/users/${u.id}/block`, { method: 'POST', body: { blocked: !u.is_blocked } });
    load();
  }
  async function adjust(u: AdminUser) {
    const raw = window.prompt(`Adjust ${u.name}'s wallet. Use a minus sign to take money out.`, '100');
    if (!raw) return;
    await api(`/admin/users/${u.id}/credit`, { method: 'POST', body: { amount: Number(raw) } });
    load();
  }

  return (
    <>
      <input className="search-input admin-search" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>#</th><th>Name</th><th>Role</th><th>Contact</th><th>Rides</th><th>Wallet</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_blocked ? 'row-muted' : ''}>
                <td>{u.id}</td>
                <td>
                  {u.name}
                  {u.is_admin ? <span className="tag">admin</span> : null}
                </td>
                <td>
                  {u.role}
                  {u.role === 'driver' && u.vehicle_type ? ` · ${u.vehicle_type}` : ''}
                </td>
                <td className="ellipsis">{u.email}<br /><small className="muted">{u.phone || ''}</small></td>
                <td>{u.rides}</td>
                <td className={signedClass(u.balance)}>{money(u.balance)}</td>
                <td>
                  {u.is_blocked ? <span className="status-badge status-cancelled">Blocked</span> : u.role === 'driver' ? (
                    <span className={`status-badge status-${u.approval_status === 'approved' ? 'completed' : 'requested'}`}>
                      {u.approval_status}{u.is_online ? ' · online' : ''}
                    </span>
                  ) : <span className="status-badge status-completed">Active</span>}
                </td>
                <td className="nowrap">
                  <button className="btn btn-light btn-sm" onClick={() => adjust(u)}>Wallet</button>{' '}
                  <button className={`btn btn-sm ${u.is_blocked ? 'btn-light' : 'btn-danger-ghost'}`} onClick={() => block(u)}>
                    {u.is_blocked ? 'Unblock' : 'Block'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Drivers({ onChange }: { onChange: () => void }) {
  const [drivers, setDrivers] = useState<PendingDriver[]>([]);
  const load = useCallback(() => {
    api<{ drivers: PendingDriver[] }>('/admin/drivers/pending').then((r) => setDrivers(r.drivers)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function decide(id: number, status: 'approved' | 'rejected') {
    const note = status === 'rejected' ? window.prompt('Why is it rejected? The driver sees this.') || '' : '';
    await api(`/admin/drivers/${id}/approval`, { method: 'POST', body: { status, note } });
    load();
    onChange();
  }

  return (
    <ul className="trip-list">
      {drivers.map((d) => (
        <li key={d.id} className="card">
          <div className="trip-head">
            <div>
              <strong>{d.name}</strong>
              <small>
                {d.email} · {d.phone || 'no phone'} · {d.vehicle_type} {d.vehicle_make} {d.vehicle_model} {d.plate ? `· ${d.plate}` : ''}
              </small>
            </div>
            <span className={`status-badge status-${d.approval_status === 'approved' ? 'completed' : d.approval_status === 'rejected' ? 'cancelled' : 'requested'}`}>
              {d.approval_status}
            </span>
          </div>
          <div className="doc-chips">
            {['licence', 'rc', 'insurance', 'permit', 'photo'].map((k) => {
              const doc = d.documents.find((x) => x.kind === k);
              return (
                <span key={k} className={`chip ${doc ? (doc.status === 'approved' ? 'chip-ok' : 'chip-warn') : 'chip-missing'}`}>
                  {k}
                  {doc?.number ? ` ${doc.number}` : ''}
                  {!doc ? ' ✕' : ''}
                </span>
              );
            })}
          </div>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" onClick={() => decide(d.id, 'approved')}>Approve</button>
            <button className="btn btn-danger-ghost btn-sm" onClick={() => decide(d.id, 'rejected')}>Reject</button>
          </div>
        </li>
      ))}
      {drivers.length === 0 && <p className="muted">No drivers registered yet.</p>}
    </ul>
  );
}

function Fares() {
  const [pricing, setPricing] = useState<Pricing[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ pricing: Pricing[] }>('/admin/pricing').then((r) => setPricing(r.pricing)).catch(() => {});
  }, []);

  async function save(p: Pricing) {
    await api(`/admin/pricing/${p.vehicle_type}`, { method: 'PUT', body: p });
    setMsg(`${p.label} saved. New rides use the new prices immediately.`);
  }
  const set = (type: string, field: keyof Pricing, value: string) =>
    setPricing((cur) => cur.map((p) => (p.vehicle_type === type ? { ...p, [field]: Number(value) } : p)));

  return (
    <>
      <p className="muted">Fare = base + per km × km × surge + per min × min × surge + booking fee, never below the minimum.</p>
      {msg && <div className="ok">{msg}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Class</th><th>Base</th><th>Per km</th><th>Per min</th><th>Minimum</th><th>Booking</th><th>Cancel fee</th><th /></tr>
          </thead>
          <tbody>
            {pricing.map((p) => (
              <tr key={p.vehicle_type}>
                <td><strong>{p.label}</strong><br /><small className="muted">{p.vehicle_type}</small></td>
                {(['base_fare', 'per_km', 'per_min', 'min_fare', 'booking_fee', 'cancel_fee'] as const).map((f) => (
                  <td key={f}>
                    <input className="cell-input" type="number" step="0.5" value={p[f] as number} onChange={(e) => set(p.vehicle_type, f, e.target.value)} />
                  </td>
                ))}
                <td><button className="btn btn-primary btn-sm" onClick={() => save(p)}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Promos() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [form, setForm] = useState({ code: '', description: '', kind: 'percent', value: 20, max_discount: 100, min_fare: 0, per_user_limit: 1, total_limit: 0 });
  const load = useCallback(() => {
    api<{ promos: Promo[] }>('/admin/promos').then((r) => setPromos(r.promos)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function save() {
    if (!form.code.trim()) return;
    const { promos } = await api<{ promos: Promo[] }>('/admin/promos', { method: 'POST', body: form });
    setPromos(promos);
    setForm({ ...form, code: '', description: '' });
  }

  return (
    <>
      <div className="card form">
        <div className="grid-2">
          <label>Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER25" /></label>
          <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">Percent off</option>
              <option value="flat">Flat amount off</option>
            </select>
          </label>
          <label>Value<input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></label>
          <label>Max discount (0 = no cap)<input type="number" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: Number(e.target.value) })} /></label>
          <label>Minimum fare<input type="number" value={form.min_fare} onChange={(e) => setForm({ ...form, min_fare: Number(e.target.value) })} /></label>
          <label>Uses per rider<input type="number" value={form.per_user_limit} onChange={(e) => setForm({ ...form, per_user_limit: Number(e.target.value) })} /></label>
          <label>Total uses (0 = unlimited)<input type="number" value={form.total_limit} onChange={(e) => setForm({ ...form, total_limit: Number(e.target.value) })} /></label>
        </div>
        <button className="btn btn-primary" onClick={save}>Save code</button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>What it does</th><th>Used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.code} className={p.active ? '' : 'row-muted'}>
                <td><strong>{p.code}</strong></td>
                <td>
                  {p.kind === 'percent' ? `${p.value}% off` : `${money(p.value)} off`}
                  {p.max_discount ? `, max ${money(p.max_discount)}` : ''}
                  {p.min_fare ? `, over ${money(p.min_fare)}` : ''}
                  <br /><small className="muted">{p.description}</small>
                </td>
                <td>{p.used_count}{p.total_limit ? ` / ${p.total_limit}` : ''}</td>
                <td>{p.active ? <span className="status-badge status-completed">Active</span> : <span className="status-badge status-cancelled">Off</span>}</td>
                <td>
                  {p.active ? (
                    <button className="btn btn-danger-ghost btn-sm" onClick={async () => { await api(`/admin/promos/${p.code}`, { method: 'DELETE' }); load(); }}>
                      Turn off
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Surge() {
  const [zones, setZones] = useState<SurgeZone[]>([]);
  const [form, setForm] = useState({ name: '', lat: 28.6139, lng: 77.209, radius_km: 3, multiplier: 1.5, active: 1 });
  const load = useCallback(() => {
    api<{ zones: SurgeZone[] }>('/admin/surge').then((r) => setZones(r.zones)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <p className="muted">
        Inside a zone, the per-km and per-minute parts of the fare are multiplied. The base fare and booking fee never surge. Live
        demand can raise it further on its own, up to ×2.5.
      </p>
      <div className="card form">
        <div className="grid-2">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Airport" /></label>
          <label>Multiplier<input type="number" step="0.1" min="1" max="2.5" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: Number(e.target.value) })} /></label>
          <label>Latitude<input type="number" step="0.0001" value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} /></label>
          <label>Longitude<input type="number" step="0.0001" value={form.lng} onChange={(e) => setForm({ ...form, lng: Number(e.target.value) })} /></label>
          <label>Radius (km)<input type="number" step="0.5" value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: Number(e.target.value) })} /></label>
        </div>
        <button className="btn btn-primary" onClick={async () => { await api('/admin/surge', { method: 'POST', body: form }); load(); }}>
          Add zone
        </button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Zone</th><th>Centre</th><th>Radius</th><th>Multiplier</th><th>Status</th><th /></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className={z.active ? '' : 'row-muted'}>
                <td><strong>{z.name}</strong></td>
                <td>{z.lat.toFixed(4)}, {z.lng.toFixed(4)}</td>
                <td>{z.radius_km} km</td>
                <td>×{z.multiplier}</td>
                <td>{z.active ? <span className="status-badge status-in_progress">On</span> : <span className="status-badge status-cancelled">Off</span>}</td>
                <td className="nowrap">
                  <button className="btn btn-light btn-sm" onClick={async () => { await api('/admin/surge', { method: 'POST', body: { ...z, active: z.active ? 0 : 1 } }); load(); }}>
                    {z.active ? 'Turn off' : 'Turn on'}
                  </button>{' '}
                  <button className="btn btn-danger-ghost btn-sm" onClick={async () => { await api(`/admin/surge/${z.id}`, { method: 'DELETE' }); load(); }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Safety({ onChange }: { onChange: () => void }) {
  const [alerts, setAlerts] = useState<SosAlert[]>([]);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => {
    api<{ alerts: SosAlert[] }>(`/admin/sos${showAll ? '?all=1' : ''}`).then((r) => setAlerts(r.alerts)).catch(() => {});
  }, [showAll]);
  useEffect(() => {
    load();
    const s = getSocket();
    s?.on('sos:new', load);
    return () => {
      s?.off('sos:new', load);
    };
  }, [load]);

  return (
    <>
      <label className="sim-toggle">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include resolved
      </label>
      <ul className="trip-list">
        {alerts.map((a) => (
          <li key={a.id} className={`card ${a.status === 'open' ? 'sos-open' : ''}`}>
            <div className="trip-head">
              <div>
                <strong>🚨 {a.user_name} ({a.role})</strong>
                <small>
                  {formatDate(a.created_at)}
                  {a.ride_id ? ` · ride #${a.ride_id}` : ''}
                  {a.lat != null ? ` · ${a.lat.toFixed(4)}, ${a.lng?.toFixed(4)}` : ''}
                  {a.note ? ` · ${a.note}` : ''}
                </small>
              </div>
              <span className={`status-badge status-${a.status === 'resolved' ? 'completed' : 'cancelled'}`}>{a.status}</span>
            </div>
            <div className="row-actions">
              {a.user_phone && <a className="btn btn-light btn-sm" href={`tel:${a.user_phone}`}>Call {a.user_phone}</a>}
              {a.lat != null && (
                <a className="btn btn-ghost btn-sm" href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}#map=17/${a.lat}/${a.lng}`} target="_blank" rel="noreferrer">
                  Open map
                </a>
              )}
              {a.status !== 'resolved' && (
                <button className="btn btn-primary btn-sm" onClick={async () => { await api(`/admin/sos/${a.id}/resolve`, { method: 'POST', body: { status: 'resolved' } }); load(); onChange(); }}>
                  Mark resolved
                </button>
              )}
            </div>
          </li>
        ))}
        {alerts.length === 0 && <p className="muted">No alerts. All clear.</p>}
      </ul>
    </>
  );
}

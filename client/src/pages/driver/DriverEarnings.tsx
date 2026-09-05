import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { STATUS_LABEL, formatDate, km, money, rideLedger, shortAddress, signed, signedClass } from '../../lib/format';
import type { Ride } from '../../lib/types';

interface Totals {
  rides: number;
  earned: number;
  fees: number;
  penalties: number;
  km: number;
  net: number;
}
interface Earnings {
  all_time: Totals;
  today: Totals;
}

export default function DriverEarnings() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);

  useEffect(() => {
    api<Earnings>('/drivers/me/earnings').then(setEarnings).catch(() => {});
    api<{ rides: Ride[] }>('/rides').then((r) => setRides(r.rides)).catch(() => {});
  }, []);

  const t = earnings?.today;
  const a = earnings?.all_time;

  return (
    <main className="page">
      <h1>Earnings</h1>
      <div className="stat-row">
        <div className="card stat">
          <small>Today · net</small>
          <strong className={signedClass(t?.net ?? 0)}>{signed(t?.net ?? 0)}</strong>
          <span>
            {t?.rides ?? 0} trips · {signed(t?.earned ?? 0)} fares
            {t?.fees ? ` · ${signed(t.fees)} fees` : ''}
            {t?.penalties ? ` · ${signed(-t.penalties)} penalties` : ''}
          </span>
        </div>
        <div className="card stat">
          <small>All time · net</small>
          <strong className={signedClass(a?.net ?? 0)}>{signed(a?.net ?? 0)}</strong>
          <span>
            {a?.rides ?? 0} trips · {signed(a?.earned ?? 0)} fares
            {a?.fees ? ` · ${signed(a.fees)} fees` : ''}
            {a?.penalties ? ` · ${signed(-a.penalties)} penalties` : ''}
          </span>
        </div>
        <div className="card stat">
          <small>Distance driven</small>
          <strong>{km(a?.km ?? 0)}</strong>
          <span>on completed trips</span>
        </div>
      </div>

      <h2>Ledger</h2>
      <p className="muted">
        <span className="amt amt-pos">+</span> money you earned · <span className="amt amt-neg">−</span> money deducted (cancelling after accepting costs{' '}
        {money(20)})
      </p>
      {rides.length === 0 && <p className="muted">No trips yet.</p>}
      <ul className="trip-list">
        {rides.map((r) => {
          const l = rideLedger(r, 'driver');
          return (
            <li key={r.id} className="card trip-item">
              <div className="trip-head">
                <div>
                  <strong>
                    {shortAddress(r.pickup_address)} → {shortAddress(r.dropoff_address)}
                  </strong>
                  <small>
                    {formatDate(r.created_at)} · {km(r.distance_km)} · <span className={`status-badge status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    {r.customer_rating ? ` · you rated rider ${r.customer_rating} ★` : ''}
                    {r.driver_rating ? ` · rider rated you ${r.driver_rating} ★` : ''}
                  </small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b className={signedClass(l.amount)}>{signed(l.amount, r.currency)}</b>
                  <span className="ledger-note">{l.note}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

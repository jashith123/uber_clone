import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { STATUS_LABEL, formatDate, km, money, shortAddress } from '../../lib/format';
import type { Ride } from '../../lib/types';

interface Earnings {
  all_time: { rides: number; total: number; km: number };
  today: { rides: number; total: number };
}

export default function DriverEarnings() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);

  useEffect(() => {
    api<Earnings>('/drivers/me/earnings').then(setEarnings).catch(() => {});
    api<{ rides: Ride[] }>('/rides').then((r) => setRides(r.rides)).catch(() => {});
  }, []);

  return (
    <main className="page">
      <h1>Earnings</h1>
      <div className="stat-row">
        <div className="card stat">
          <small>Today</small>
          <strong>{money(earnings?.today.total ?? 0)}</strong>
          <span>{earnings?.today.rides ?? 0} trips</span>
        </div>
        <div className="card stat">
          <small>All time</small>
          <strong>{money(earnings?.all_time.total ?? 0)}</strong>
          <span>{earnings?.all_time.rides ?? 0} trips</span>
        </div>
        <div className="card stat">
          <small>Distance driven</small>
          <strong>{km(earnings?.all_time.km ?? 0)}</strong>
          <span>on completed trips</span>
        </div>
      </div>

      <h2>Trip history</h2>
      {rides.length === 0 && <p className="muted">No trips yet.</p>}
      <ul className="trip-list">
        {rides.map((r) => (
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
              <b>{r.status === 'completed' ? money(r.fare_final, r.currency) : '—'}</b>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

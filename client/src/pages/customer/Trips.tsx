import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { STATUS_LABEL, formatDate, km, rideLedger, shortAddress, signed, signedClass } from '../../lib/format';
import type { Ride } from '../../lib/types';

export default function Trips() {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api<{ rides: Ride[] }>('/rides').then((r) => setRides(r.rides)).catch(() => setRides([]));
  }, []);

  const total = (rides ?? []).reduce((sum, r) => sum + rideLedger(r, 'customer').amount, 0);
  const fees = (rides ?? []).reduce((sum, r) => sum + (r.status === 'cancelled' ? r.cancel_fee : 0), 0);

  return (
    <main className="page">
      <h1>My trips</h1>
      {rides && rides.length > 0 && (
        <div className="stat-row">
          <div className="card stat">
            <small>Total spent</small>
            <strong className={signedClass(total)}>{signed(total)}</strong>
            <span>{rides.filter((r) => r.status === 'completed').length} completed trips</span>
          </div>
          <div className="card stat">
            <small>Cancellation fees</small>
            <strong className={signedClass(-fees)}>{signed(-fees)}</strong>
            <span>charged after the 2-minute grace period</span>
          </div>
        </div>
      )}
      {rides === null && <p className="muted">Loading…</p>}
      {rides?.length === 0 && <p className="muted">No trips yet. Book your first ride!</p>}
      <ul className="trip-list">
        {rides?.map((r) => {
          const l = rideLedger(r, 'customer');
          return (
            <li key={r.id} className="card trip-item" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="trip-head">
                <div>
                  <strong>{shortAddress(r.dropoff_address, 'Drop-off')}</strong>
                  <small>
                    {formatDate(r.created_at)} · {km(r.distance_km)} · {r.waypoints.length - 2 > 0 ? `${r.waypoints.length - 2} stop(s) · ` : ''}
                    <span className={`status-badge status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </small>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b className={signedClass(l.amount)}>{signed(l.amount, r.currency)}</b>
                  <span className="ledger-note">{l.note}</span>
                </div>
              </div>
              {open === r.id && (
                <div className="trip-detail">
                  <ol className="trip-path">
                    {r.waypoints.map((w, i) => (
                      <li key={i} className={i === 0 ? 'pickup' : i === r.waypoints.length - 1 ? 'dropoff' : 'stop'}>
                        {shortAddress(w.address)}
                      </li>
                    ))}
                  </ol>
                  {r.driver && (
                    <p>
                      Driver: <strong>{r.driver.name}</strong> · {r.driver.vehicle} · {r.driver.plate}
                    </p>
                  )}
                  <p className="muted">
                    {r.vehicle_type} · paid by {r.payment_method}
                    {r.driver_rating ? ` · you rated ${r.driver_rating} ★` : ''}
                    {r.cancel_reason ? ` · reason: ${r.cancel_reason}` : ''}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

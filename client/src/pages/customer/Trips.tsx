import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { STATUS_LABEL, formatDate, km, rideLedger, shortAddress, signed, signedClass } from '../../lib/format';
import type { Ride } from '../../lib/types';

export default function Trips() {
  const { user } = useAuth();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [stars, setStars] = useState(0);
  const [rating, setRating] = useState(false);

  function toggle(id: number) {
    setOpen(open === id ? null : id);
    setStars(0);
  }

  /** Rate a finished trip from history, for riders who closed the receipt before rating. */
  async function rate(id: number) {
    setRating(true);
    try {
      await api(`/rides/${id}/rate`, { method: 'POST', body: { stars } });
      setRides((list) => list?.map((x) => (x.id === id ? { ...x, driver_rating: stars } : x)) ?? null);
      setStars(0);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setRating(false);
    }
  }

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
            <small>Your rating</small>
            <strong>{user?.rating != null ? `★ ${user.rating.toFixed(1)}` : 'New'}</strong>
            <span>{user?.rating_count ? `average of ${user.rating_count} driver rating${user.rating_count === 1 ? '' : 's'}` : 'no ratings yet'}</span>
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
            <li key={r.id} className="card trip-item" onClick={() => toggle(r.id)}>
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
                  {r.status === 'completed' && !r.driver_rating && r.driver && (
                    <div className="rate" onClick={(e) => e.stopPropagation()}>
                      <p>Rate your driver</p>
                      <div className="stars">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n} stars`}>
                            ★
                          </button>
                        ))}
                      </div>
                      <button className="btn btn-primary btn-sm" disabled={!stars || rating} onClick={() => rate(r.id)}>
                        Submit rating
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { STATUS_LABEL, formatDate, km, money, rideLedger, shortAddress, signed, signedClass } from '../../lib/format';
import type { Ride } from '../../lib/types';

interface Totals {
  rides: number;
  km: number;
  gross: number;
  earned: number;
  fees: number;
  penalties: number;
  commission: number;
  net: number;
}
interface Earnings {
  all_time: Totals;
  today: Totals;
  balance: number;
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
          <small>Today · take-home</small>
          <strong className={signedClass(t?.net ?? 0)}>{signed(t?.net ?? 0)}</strong>
          <span>{t?.rides ?? 0} trips · {money(t?.gross ?? 0)} collected</span>
        </div>
        <div className="card stat">
          <small>All time · take-home</small>
          <strong className={signedClass(a?.net ?? 0)}>{signed(a?.net ?? 0)}</strong>
          <span>{a?.rides ?? 0} trips · {km(a?.km ?? 0)}</span>
        </div>
        <div className="card stat">
          <small>Wallet balance</small>
          <strong className={signedClass(earnings?.balance ?? 0)}>{money(earnings?.balance ?? 0)}</strong>
          <span>
            <Link to="/wallet">Withdraw or view history</Link>
          </span>
        </div>
      </div>

      {a && (
        <div className="card breakdown">
          <h2 style={{ marginTop: 0 }}>Where the money went (all time)</h2>
          <div className="row"><span>Fares collected from riders</span><span>{money(a.gross)}</span></div>
          <div className="row"><span>Paid into your wallet</span><span className={signedClass(a.earned)}>{signed(a.earned)}</span></div>
          <div className="row"><span>Late-cancellation fees you received</span><span className={signedClass(a.fees)}>{signed(a.fees)}</span></div>
          <div className="row"><span>Commission on cash rides</span><span className={signedClass(-a.commission)}>{signed(-a.commission)}</span></div>
          <div className="row"><span>Penalties for cancelling after accepting</span><span className={signedClass(-a.penalties)}>{signed(-a.penalties)}</span></div>
          <div className="row row-bold"><span>Your take-home</span><span className={signedClass(a.net)}>{signed(a.net)}</span></div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            On wallet and card rides the commission is already taken out before the money reaches you. On cash rides you keep the
            fare and the commission is deducted from your wallet instead.
          </p>
        </div>
      )}

      <h2>Ledger</h2>
      <p className="muted">
        <span className="amt amt-pos">+</span> money you earned · <span className="amt amt-neg">−</span> money deducted
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
                    {r.surge_multiplier > 1 ? ` · ×${r.surge_multiplier}` : ''}
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

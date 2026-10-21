import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { STATUS_LABEL, formatDate, km, money, rideLedger, shortAddress, signed, signedClass } from '../../lib/format';
import type { Ride } from '../../lib/types';

interface Totals {
  rides: number;
  km: number;
  gross: number;
  cash_gross: number;
  wallet_gross: number;
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
  withdrawable: number;
  owed: number;
  commission_percent: number;
  payout_requested: number;
  free_rides_total: number;
  free_rides_used: number;
  rating: number | null;
  rating_count: number;
}

export default function DriverEarnings() {
  const nav = useNavigate();
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, r] = await Promise.all([api<Earnings>('/drivers/me/earnings'), api<{ rides: Ride[] }>('/rides')]);
    setEarnings(e);
    setRides(r.rides);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  /** Withdraw everything that can be withdrawn. Test mode records it; a real payout needs a bank integration. */
  async function withdraw() {
    if (!earnings || earnings.withdrawable <= 0) return;
    if (!window.confirm(`Ask the company to pay ${money(earnings.withdrawable)} to your bank account?`)) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api('/payments/payout', { method: 'POST', body: { amount: earnings.withdrawable } });
      await load();
      setMsg(`Payout of ${money(earnings.withdrawable)} requested. The company pays it to your bank; it leaves your wallet when they do.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const t = earnings?.today;
  const a = earnings?.all_time;
  const pct = earnings?.commission_percent ?? 10;

  return (
    <main className="page">
      <h1>Earnings</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="stat-row">
        <div className="card stat">
          <small>Today · your earnings</small>
          <strong className={signedClass(t?.net ?? 0)}>{signed(t?.net ?? 0)}</strong>
          <span>
            {t?.rides ?? 0} trips · {money(t?.gross ?? 0)} in fares
          </span>
        </div>
        <div className="card stat">
          <small>All time · your earnings</small>
          <strong className={signedClass(a?.net ?? 0)}>{signed(a?.net ?? 0)}</strong>
          <span>
            {a?.rides ?? 0} trips · {km(a?.km ?? 0)}
          </span>
        </div>
        <div className="card stat">
          <small>Commission-free welcome rides</small>
          <strong>{earnings ? `${Math.max(0, earnings.free_rides_total - earnings.free_rides_used)} left` : '—'}</strong>
          <span>{earnings ? `${earnings.free_rides_used} of ${earnings.free_rides_total} used; after that ${pct}% commission applies` : ''}</span>
        </div>
        <div className="card stat">
          <small>Your rating</small>
          <strong>{earnings?.rating != null ? `★ ${earnings.rating.toFixed(1)}` : 'New'}</strong>
          <span>{earnings?.rating_count ? `average of ${earnings.rating_count} rider rating${earnings.rating_count === 1 ? '' : 's'}` : 'no ratings yet'}</span>
        </div>
      </div>

      {earnings && (
        <div className="stat-row">
          <div className="card stat">
            <small>Earnings the company owes you</small>
            <strong className={signedClass(earnings.withdrawable)}>{money(earnings.withdrawable)}</strong>
            <span>
              {earnings.withdrawable > 0 ? (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={withdraw}>
                  {busy ? 'Working…' : earnings.payout_requested > 0 ? `Requested ${money(earnings.payout_requested)} · ask again` : `Request payout of ${money(earnings.withdrawable)}`}
                </button>
              ) : (
                'nothing to pay out yet'
              )}
            </span>
          </div>
          <div className="card stat">
            <small>Fines and dues to pay</small>
            <strong className={signedClass(-earnings.owed)}>{money(earnings.owed)}</strong>
            <span>
              {earnings.owed > 0 ? (
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => nav(`/wallet?amount=${Math.ceil(earnings.owed)}`)}>
                  Pay {money(earnings.owed)} now
                </button>
              ) : (
                'nothing owed'
              )}
            </span>
          </div>
          <div className="card stat">
            <small>Wallet balance</small>
            <strong className={signedClass(earnings.balance)}>{money(earnings.balance)}</strong>
            <span>
              <Link to="/wallet">Full history</Link>
            </span>
          </div>
        </div>
      )}

      {a && (
        <div className="card breakdown">
          <h2 style={{ marginTop: 0 }}>How your earnings are worked out (all time)</h2>
          <div className="row"><span>Fares paid by riders</span><span>{money(a.gross)}</span></div>
          <div className="row"><span>Platform commission · {pct}% of every fare</span><span className={signedClass(-a.commission)}>{signed(-a.commission)}</span></div>
          <div className="row row-bold"><span>Your share · {100 - pct}% of every fare</span><span className={signedClass(a.gross - a.commission)}>{signed(a.gross - a.commission)}</span></div>
          <div className="row indent"><span>of which cash you collected in hand</span><span>{money(a.cash_gross)}</span></div>
          <div className="row indent"><span>of which paid into your wallet (wallet and card rides)</span><span className={signedClass(a.earned)}>{signed(a.earned)}</span></div>
          <div className="row"><span>Late-cancellation fees you received</span><span className={signedClass(a.fees)}>{signed(a.fees)}</span></div>
          <div className="row"><span>Penalties for cancelling after accepting</span><span className={signedClass(-a.penalties)}>{signed(-a.penalties)}</span></div>
          <div className="row row-bold"><span>Your earnings</span><span className={signedClass(a.net)}>{signed(a.net)}</span></div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            On wallet and card rides your {100 - pct}% is paid into your wallet straight away. On cash rides you keep the whole fare in hand,
            so the {pct}% commission on those is taken from your wallet instead; if the wallet runs short it shows up above as dues to pay.
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

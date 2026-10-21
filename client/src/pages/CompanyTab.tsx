import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, money, signed, signedClass } from '../lib/format';

interface Account {
  id: number;
  role: 'customer' | 'driver';
  name: string;
  email: string;
  phone: string | null;
  is_admin: number;
  is_owner: number;
  is_blocked: number;
  created_at: string;
  vehicle_type: string | null;
  plate: string | null;
  approval_status: string | null;
  is_online: number | null;
  upi_id: string | null;
  payout_requested: number | null;
  balance: number;
  rides: number;
  fares: number;
  commission: number;
  spent: number;
}

interface LedgerRow {
  id: number;
  amount: number;
  balance_after: number;
  type: string;
  ride_id: number | null;
  user_id: number | null;
  note: string | null;
  created_at: string;
}

interface Books {
  company: { name: string; upi_id: string; commission_percent: number };
  cash_held: number;
  profit: number;
  profit_today: number;
  fares: number;
  rides: number;
  collected_online: number;
  commission_from_drivers: number;
  topups: number;
  paid_out: number;
  owed_to_drivers: number;
  owed_by_drivers: number;
  owed_to_riders: number;
  payout_requests: { id: number; name: string; amount: number; at: string; balance: number }[];
  ledger: LedgerRow[];
  accounts: Account[];
}

const LEDGER_LABEL: Record<string, string> = {
  topup: 'Money added by a user',
  collection: 'Fare paid online',
  commission: 'Commission from a driver',
  driver_payout: 'Paid out to a driver',
};

/**
 * The owner's view: the company's books, every account with its wallet, and
 * the button that pays a driver what the company owes him.
 */
export default function CompanyTab() {
  const [books, setBooks] = useState<Books | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Books>('/admin/company').then(setBooks).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  async function pay(a: { id: number; name: string; balance: number; payout_requested?: number | null }) {
    const suggested = a.payout_requested && a.payout_requested > 0 ? a.payout_requested : a.balance;
    const raw = window.prompt(`Pay ${a.name} from the company account. Wallet holds ${money(a.balance)}.`, String(Math.max(0, suggested).toFixed(2)));
    if (!raw) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api(`/admin/drivers/${a.id}/payout`, { method: 'POST', body: { amount: Number(raw) } });
      setMsg(`Paid ${money(Number(raw))} to ${a.name}. Recorded on both the company's and the driver's ledger.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!books) return <p className="muted">{error || 'Loading the books…'}</p>;
  const drivers = books.accounts.filter((a) => a.role === 'driver');
  const riders = books.accounts.filter((a) => a.role === 'customer');

  return (
    <>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <p className="muted">
        {books.company.name} · company UPI <b>{books.company.upi_id}</b> · commission {books.company.commission_percent}% of every fare, the rest
        is the driver's.
      </p>

      <div className="stat-grid">
        <div className="card stat"><small>Profit · all commission</small><strong className={signedClass(books.profit)}>{money(books.profit)}</strong><span>{money(books.profit_today)} today · {books.rides} paid rides · {money(books.fares)} in fares</span></div>
        <div className="card stat"><small>Cash the company holds</small><strong>{money(books.cash_held)}</strong><span>top-ups {money(books.topups)} + online fares {money(books.collected_online)} + commission {money(books.commission_from_drivers)} − paid out {money(books.paid_out)}</span></div>
        <div className="card stat"><small>Owed to drivers</small><strong className="amt-neg">{money(books.owed_to_drivers)}</strong><span>positive driver wallets, paid out below</span></div>
        <div className="card stat"><small>Owed by drivers</small><strong className="amt-pos">{money(books.owed_by_drivers)}</strong><span>negative wallets: commission still due</span></div>
        <div className="card stat"><small>Owed to riders</small><strong className="amt-neg">{money(books.owed_to_riders)}</strong><span>unspent rider wallet balances</span></div>
        <div className="card stat"><small>Net position</small><strong className={signedClass(books.cash_held - books.owed_to_drivers - books.owed_to_riders)}>{signed(books.cash_held - books.owed_to_drivers - books.owed_to_riders)}</strong><span>cash held minus what is owed out</span></div>
      </div>

      {books.payout_requests.length > 0 && (
        <>
          <h2>Payout requests</h2>
          <ul className="trip-list">
            {books.payout_requests.map((p) => (
              <li key={p.id} className="card trip-item">
                <div className="trip-head">
                  <div>
                    <strong>{p.name}</strong>
                    <small>asked for {money(p.amount)} · {formatDate(p.at)} · wallet {money(p.balance)}</small>
                  </div>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => pay({ id: p.id, name: p.name, balance: p.balance, payout_requested: p.amount })}>
                    Pay {money(p.amount)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Drivers</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>#</th><th>Driver</th><th>Vehicle</th><th>Rides</th><th>Fares</th><th>Our commission</th><th>Wallet</th><th>UPI</th><th /></tr>
          </thead>
          <tbody>
            {drivers.map((a) => (
              <tr key={a.id} className={a.is_blocked ? 'row-muted' : ''}>
                <td>{a.id}</td>
                <td>{a.name}<br /><small className="muted">{a.email}</small></td>
                <td>{a.vehicle_type}<br /><small className="muted">{a.plate || '—'}{a.is_online ? ' · online' : ''}</small></td>
                <td>{a.rides}</td>
                <td>{money(a.fares)}</td>
                <td className="amt-pos">{money(a.commission)}</td>
                <td className={signedClass(a.balance)}>
                  {money(a.balance)}
                  {a.payout_requested ? <><br /><small className="muted">asked for {money(a.payout_requested)}</small></> : null}
                </td>
                <td className="ellipsis">{a.upi_id || <span className="muted">none</span>}</td>
                <td className="nowrap">
                  {a.balance > 0 ? (
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => pay(a)}>Pay</button>
                  ) : a.balance < 0 ? (
                    <span className="status-badge status-cancelled">owes {money(-a.balance)}</span>
                  ) : (
                    <span className="muted">settled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Riders and staff</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>#</th><th>Account</th><th>Role</th><th>Rides</th><th>Spent</th><th>Wallet</th><th>Status</th></tr>
          </thead>
          <tbody>
            {riders.map((a) => (
              <tr key={a.id} className={a.is_blocked ? 'row-muted' : ''}>
                <td>{a.id}</td>
                <td>{a.name}<br /><small className="muted">{a.email}</small></td>
                <td>{a.is_owner ? 'owner' : a.is_admin ? 'admin' : 'rider'}</td>
                <td>{a.rides}</td>
                <td>{money(a.spent)}</td>
                <td className={signedClass(a.balance)}>{money(a.balance)}</td>
                <td>{a.is_blocked ? <span className="status-badge status-cancelled">Blocked</span> : <span className="status-badge status-completed">Active</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Company ledger</h2>
      <ul className="trip-list">
        {books.ledger.length === 0 && <li className="muted">Nothing yet.</li>}
        {books.ledger.map((t) => (
          <li key={t.id} className="card trip-item">
            <div className="trip-head">
              <div>
                <strong>{LEDGER_LABEL[t.type] || t.type}</strong>
                <small>{formatDate(t.created_at)}{t.ride_id ? ` · ride #${t.ride_id}` : ''}{t.note ? ` · ${t.note}` : ''}</small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <b className={signedClass(t.amount)}>{signed(t.amount)}</b>
                <span className="ledger-note">holds {money(t.balance_after)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

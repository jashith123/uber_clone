import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, money, signed, signedClass } from '../lib/format';
import type { PaymentConfig, Wallet as WalletT, WalletTx } from '../lib/types';

const TX_LABEL: Record<string, string> = {
  topup: 'Money added',
  ride_fare: 'Ride paid',
  ride_earning: 'Ride earning',
  cancel_fee: 'Late-cancellation fee',
  cancel_penalty: 'Cancellation penalty',
  commission: 'Platform commission',
  payout: 'Payout to bank',
  refund: 'Refund',
  promo: 'Promo credit',
  adjustment: 'Adjustment by support',
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function WalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletT | null>(null);
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [amount, setAmount] = useState('500');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [w, c] = await Promise.all([
      api<{ wallet: WalletT; transactions: WalletTx[] }>('/payments/wallet'),
      api<PaymentConfig>('/payments/config'),
    ]);
    setWallet(w.wallet);
    setTxs(w.transactions);
    setCfg(c);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function topup() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const order = await api<{ payment_id: number; provider: string; order_id: string; amount: number; key_id: string | null }>(
        '/payments/topup',
        { method: 'POST', body: { amount: Number(amount) } },
      );

      if (order.provider === 'razorpay' && order.key_id) {
        const ok = await loadRazorpay();
        if (!ok) throw new Error('Could not load the payment window. Check your connection.');
        await new Promise<void>((resolve, reject) => {
          const rz = new window.Razorpay!({
            key: order.key_id,
            order_id: order.order_id,
            amount: order.amount * 100,
            currency: 'INR',
            name: 'SwiftRide',
            description: 'Wallet top-up',
            prefill: { name: user?.name, email: user?.email, contact: user?.phone || '' },
            handler: async (resp: Record<string, string>) => {
              try {
                await api('/payments/topup/confirm', { method: 'POST', body: { payment_id: order.payment_id, ...resp } });
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            modal: { ondismiss: () => reject(new Error('Payment window closed')) },
          });
          rz.open();
        });
      } else {
        // Mock gateway: nothing to pay, it just succeeds.
        await api('/payments/topup/confirm', { method: 'POST', body: { payment_id: order.payment_id } });
      }

      await load();
      setMsg(`${money(Number(amount))} added to your wallet.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function payout() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api('/payments/payout', { method: 'POST', body: { amount: Number(amount) } });
      await load();
      setMsg(`Payout of ${money(Number(amount))} requested.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isDriver = user?.role === 'driver';

  return (
    <main className="page narrow">
      <h1>Wallet</h1>

      <div className="card wallet-hero">
        <small>Balance</small>
        <strong className={signedClass(wallet?.balance ?? 0)}>{money(wallet?.balance ?? 0, wallet?.currency)}</strong>
        {cfg && (
          <span className="muted">
            {cfg.live ? 'Card and UPI payments are live.' : 'Test mode: top-ups are free and no real money moves.'}
            {isDriver ? ` Platform commission ${cfg.commission_percent}%.` : ''}
          </span>
        )}
      </div>

      <div className="card form">
        <label>
          Amount
          <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
        </label>
        <div className="chip-row">
          {[100, 200, 500, 1000].map((n) => (
            <button key={n} type="button" className="chip" onClick={() => setAmount(String(n))}>
              {money(n)}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        {msg && <div className="ok">{msg}</div>}
        <div className="row-actions">
          <button className="btn btn-primary" disabled={busy} onClick={topup}>
            {busy ? 'Working…' : `Add ${money(Number(amount) || 0)}`}
          </button>
          {isDriver && (
            <button className="btn btn-light" disabled={busy} onClick={payout}>
              Withdraw
            </button>
          )}
        </div>
      </div>

      <h2>History</h2>
      {txs.length === 0 && <p className="muted">Nothing yet.</p>}
      <ul className="trip-list">
        {txs.map((t) => (
          <li key={t.id} className="card trip-item">
            <div className="trip-head">
              <div>
                <strong>{TX_LABEL[t.type] || t.type}</strong>
                <small>
                  {formatDate(t.created_at)}
                  {t.ride_id ? ` · ride #${t.ride_id}` : ''}
                  {t.note ? ` · ${t.note}` : ''}
                </small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <b className={signedClass(t.amount)}>{signed(t.amount)}</b>
                <span className="ledger-note">balance {money(t.balance_after)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

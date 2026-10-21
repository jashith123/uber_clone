import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { money } from '../lib/format';
import type { Ride } from '../lib/types';

type Via = 'company_qr' | 'driver';

interface Props {
  ride: Ride;
  perspective: 'customer' | 'driver';
  busy?: boolean;
  /** Driver only: the remainder has been collected this way; finish the trip. */
  onCollected?: (via: Via) => void;
}

/** A standard UPI deep link; any UPI app opens it with the amount filled in. */
function upiLink(pa: string, pn: string, amount: number, note: string) {
  return `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
}

function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 220 })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [value]);
  return src ? <img className="qr" src={src} alt="UPI QR code" width={220} height={220} /> : <div className="qr qr-empty" />;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The end of a ride. The rider's wallet has already paid what it could; what
 * is left is shown as "pay ₹X" with the company's QR (or the option to pay the
 * driver). The driver sees "collect ₹X" and must say how it was paid before
 * the trip counts as over.
 */
export default function PayCollect({ ride, perspective, busy, onCollected }: Props) {
  const fare = ride.fare_final ?? ride.fare_estimate;
  const due = ride.due_carried || 0;
  const total = ride.total_due ?? r2(fare + due);
  const walletPaid = ride.wallet_paid || 0;
  const remainder = r2(total - walletPaid);
  const company = ride.company;
  const pct = company?.commission_percent ?? 10;
  const commission = r2((fare * pct) / 100);
  const share = r2(fare - commission);
  const [confirm, setConfirm] = useState<Via | null>(null);

  const breakdown = (
    <div className="pay-breakdown">
      <span>Fare {money(fare, ride.currency)}</span>
      {due > 0 && <span>+ {money(due, ride.currency)} cancellation fee from an earlier ride</span>}
      {walletPaid > 0 && <span>− {money(walletPaid, ride.currency)} paid from the wallet</span>}
    </div>
  );

  if (perspective === 'customer') {
    return (
      <div className="pay-box">
        <h4>Pay {money(remainder, ride.currency)} to finish your trip</h4>
        {breakdown}
        <p className="muted">
          Scan with any UPI app to pay {company?.name ?? 'the company'} directly. Your driver confirms once it arrives and the trip
          closes.
        </p>
        {company && <Qr value={upiLink(company.upi_id, company.name, remainder, `${company.name} ride ${ride.id}`)} />}
        {company && (
          <small className="muted">
            UPI ID <b>{company.upi_id}</b> · amount {money(remainder, ride.currency)}
          </small>
        )}
        <div className="pay-alt">
          Or pay the driver directly: cash{ride.driver?.upi_id ? ` or UPI ${ride.driver.upi_id}` : ''}. The driver will mark it as received.
        </div>
      </div>
    );
  }

  // What the driver keeps if he collects the remainder himself, versus his share.
  const keepsVsShare = r2(remainder - share);

  return (
    <div className="pay-box">
      <h4>
        Collect {money(remainder, ride.currency)} from {ride.customer?.name ?? 'the rider'}
      </h4>
      {breakdown}
      <p className="muted">The rider is looking at the company QR. Say how it was paid; the trip ends when you confirm.</p>
      {!confirm ? (
        <div className="row-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm('company_qr')}>
            Paid on the company QR
          </button>
          <button className="btn btn-light" disabled={busy} onClick={() => setConfirm('driver')}>
            Paid to me · cash or my QR
          </button>
        </div>
      ) : (
        <div className="confirm-box">
          <strong>
            {confirm === 'company_qr'
              ? `${money(remainder, ride.currency)} arrived on the company QR?`
              : `You received ${money(remainder, ride.currency)} in cash or on your own QR?`}
          </strong>
          <small className="muted">
            {confirm === 'company_qr'
              ? `Your share of this fare, ${money(share, ride.currency)}, is credited to your wallet now and paid out by the company.`
              : keepsVsShare > 0
                ? `You keep the ${money(remainder, ride.currency)}. Your share is ${money(share, ride.currency)}, so ${money(keepsVsShare, ride.currency)} (the ${pct}% commission${due ? ' and the carried fee' : ''}) comes out of your wallet.`
                : `You keep the ${money(remainder, ride.currency)}; the rest of your ${money(share, ride.currency)} share, ${money(-keepsVsShare, ride.currency)}, is credited to your wallet.`}
          </small>
          <div className="row-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => onCollected?.(confirm)}>
              {busy ? 'Finishing…' : 'Yes, collected · finish the trip'}
            </button>
            <button className="btn btn-light" disabled={busy} onClick={() => setConfirm(null)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

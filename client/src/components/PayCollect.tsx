import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { money } from '../lib/format';
import type { Ride } from '../lib/types';

type Via = 'company_qr' | 'driver';

interface Props {
  ride: Ride;
  perspective: 'customer' | 'driver';
  busy?: boolean;
  /** Driver only: the fare has been collected this way; finish the trip. */
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

/**
 * The end of a cash ride. The rider sees "pay ₹X" with the company's QR (or
 * the option to pay the driver directly); the driver sees "collect ₹X" and
 * must say how it was paid before the trip counts as over.
 */
export default function PayCollect({ ride, perspective, busy, onCollected }: Props) {
  const fare = ride.fare_final ?? ride.fare_estimate;
  const company = ride.company;
  const pct = company?.commission_percent ?? 10;
  const commission = Math.round(fare * pct) / 100;
  const share = Math.round((fare - commission) * 100) / 100;
  const [confirm, setConfirm] = useState<Via | null>(null);

  if (perspective === 'customer') {
    return (
      <div className="pay-box">
        <h4>Pay {money(fare, ride.currency)} to finish your trip</h4>
        <p className="muted">
          Scan with any UPI app to pay {company?.name ?? 'the company'} directly. Your driver confirms once it arrives and the trip
          closes.
        </p>
        {company && <Qr value={upiLink(company.upi_id, company.name, fare, `${company.name} ride ${ride.id}`)} />}
        {company && (
          <small className="muted">
            UPI ID <b>{company.upi_id}</b> · amount {money(fare, ride.currency)}
          </small>
        )}
        <div className="pay-alt">
          Or pay the driver directly: cash{ride.driver?.upi_id ? ` or UPI ${ride.driver.upi_id}` : ''}. The driver will mark it as received.
        </div>
      </div>
    );
  }

  return (
    <div className="pay-box">
      <h4>
        Collect {money(fare, ride.currency)} from {ride.customer?.name ?? 'the rider'}
      </h4>
      <p className="muted">The rider is looking at the company QR. Say how the fare was paid; the trip ends when you confirm.</p>
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
              ? `${money(fare, ride.currency)} arrived on the company QR?`
              : `You received ${money(fare, ride.currency)} in cash or on your own QR?`}
          </strong>
          <small className="muted">
            {confirm === 'company_qr'
              ? `Your share, ${money(share, ride.currency)}, is credited to your wallet now and paid out by the company.`
              : `You keep the fare. The ${pct}% commission, ${money(commission, ride.currency)}, comes out of your wallet.`}
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

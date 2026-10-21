import { useState } from 'react';

const RIDER_REASONS = [
  'Driver is taking too long',
  'Driver asked me to cancel',
  'I booked by mistake',
  'My plans changed',
  'Wrong pickup location',
  'Found another ride',
  'Fare is too high',
  'Other reason',
];

const DRIVER_REASONS = [
  'Rider is not at the pickup',
  'Rider is not answering',
  'Rider asked me to cancel',
  'Vehicle problem',
  'Pickup is too far away',
  'Too many passengers or luggage',
  'Personal emergency',
  'Other reason',
];

interface Props {
  perspective: 'customer' | 'driver';
  /** What cancelling costs, already worded, or null when it is free. */
  feeNote?: string | null;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Cancelling asks twice: once to open this, once to confirm with a reason.
 * The reason is stored on the ride and shown to support and in trip history.
 */
export default function CancelDialog({ perspective, feeNote, busy, onConfirm, onClose }: Props) {
  const reasons = perspective === 'driver' ? DRIVER_REASONS : RIDER_REASONS;
  const [choice, setChoice] = useState<string>('');
  const [other, setOther] = useState('');
  const isOther = choice === 'Other reason';
  const reason = isOther ? other.trim() : choice;
  const canConfirm = Boolean(reason) && !busy;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cancel-title" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3 id="cancel-title">Cancel this ride?</h3>
        {feeNote && <div className="fee-warning">{feeNote}</div>}
        <p className="muted">Tell us why, so we can improve matching.</p>
        <ul className="reason-list">
          {reasons.map((r) => (
            <li key={r}>
              <label>
                <input type="radio" name="cancel-reason" value={r} checked={choice === r} onChange={() => setChoice(r)} />
                <span>{r}</span>
              </label>
            </li>
          ))}
        </ul>
        {isOther && (
          <label>
            Your reason
            <textarea value={other} onChange={(e) => setOther(e.target.value.slice(0, 200))} rows={3} placeholder="What happened?" autoFocus />
          </label>
        )}
        <div className="row-actions">
          <button type="button" className="btn btn-light" disabled={busy} onClick={onClose}>
            Keep the ride
          </button>
          <button type="button" className="btn btn-danger" disabled={!canConfirm} onClick={() => onConfirm(reason)}>
            {busy ? 'Cancelling…' : 'Yes, cancel the ride'}
          </button>
        </div>
      </div>
    </div>
  );
}

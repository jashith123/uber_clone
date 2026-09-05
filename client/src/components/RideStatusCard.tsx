import { useState } from 'react';
import type { Ride } from '../lib/types';
import { STATUS_LABEL, km, mins, money, shortAddress, signed, signedClass } from '../lib/format';
import Comms from './Comms';

interface Props {
  ride: Ride;
  perspective: 'customer' | 'driver';
  onCancel?: (reason?: string) => Promise<void> | void;
  onAdvance?: (action: 'arrived' | 'start' | 'complete') => Promise<void> | void;
  onRate?: (stars: number) => Promise<void> | void;
  onDone?: () => void;
  busy?: boolean;
}

export default function RideStatusCard({ ride, perspective, onCancel, onAdvance, onRate, onDone, busy }: Props) {
  const [stars, setStars] = useState(0);
  const other = perspective === 'customer' ? ride.driver : ride.customer;
  const canCancel = ['requested', 'accepted', 'arrived'].includes(ride.status);
  const alreadyRated = perspective === 'customer' ? ride.driver_rating : ride.customer_rating;

  return (
    <div className="card status-card">
      <div className="status-head">
        <div>
          <div className={`status-badge status-${ride.status}`}>{STATUS_LABEL[ride.status]}</div>
          <h3 className="status-title">
            {ride.status === 'requested' && perspective === 'customer' && 'Looking for nearby drivers…'}
            {ride.status === 'accepted' && (perspective === 'customer' ? `${ride.driver?.name} is heading to you` : 'Head to the pickup')}
            {ride.status === 'arrived' && (perspective === 'customer' ? 'Your driver is here' : 'Waiting for the rider')}
            {ride.status === 'in_progress' && `Heading to ${shortAddress(ride.dropoff_address, 'drop-off')}`}
            {ride.status === 'completed' && 'Trip complete'}
            {ride.status === 'cancelled' && `Cancelled by ${ride.cancelled_by ?? 'someone'}`}
          </h3>
        </div>
        <div className="status-fare">
          <strong>{money(ride.fare_final ?? ride.fare_estimate, ride.currency)}</strong>
          <small>
            {km(ride.distance_km)} · {mins(ride.duration_min)}
          </small>
        </div>
      </div>

      {ride.status === 'requested' && perspective === 'customer' && (
        <div className="progress-bar">
          <span />
        </div>
      )}

      <ol className="trip-path">
        {ride.waypoints.map((w, i) => (
          <li key={i} className={i === 0 ? 'pickup' : i === ride.waypoints.length - 1 ? 'dropoff' : 'stop'}>
            {shortAddress(w.address, `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`)}
          </li>
        ))}
      </ol>

      {other && ride.status !== 'requested' && (
        <div className="party">
          <span className="avatar avatar-lg">{other.name.slice(0, 1)}</span>
          <div>
            <strong>{other.name}</strong>
            {perspective === 'customer' && ride.driver && (
              <small>
                {ride.driver.vehicle || 'Vehicle'} · <b>{ride.driver.plate || '—'}</b> · ★ {ride.driver.rating.toFixed(1)}
              </small>
            )}
            {perspective === 'driver' && <small>{ride.customer?.phone || 'Rider'}</small>}
          </div>
        </div>
      )}

      {other && ['accepted', 'arrived', 'in_progress'].includes(ride.status) && <Comms ride={ride} />}

      <div className="status-actions">
        {perspective === 'driver' && ride.status === 'accepted' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => onAdvance?.('arrived')}>
            I've arrived
          </button>
        )}
        {perspective === 'driver' && ['accepted', 'arrived'].includes(ride.status) && (
          <button className="btn btn-primary" disabled={busy} onClick={() => onAdvance?.('start')}>
            Start trip
          </button>
        )}
        {perspective === 'driver' && ride.status === 'in_progress' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => onAdvance?.('complete')}>
            Complete trip · {money(ride.fare_estimate, ride.currency)}
          </button>
        )}
        {canCancel && onCancel && perspective === 'customer' && ride.cancel_policy?.customer_fee > 0 && (
          <div className="fee-warning">
            Late cancellation: <b>{signed(-ride.cancel_policy.customer_fee, ride.currency)}</b> will be charged because the driver already
            {ride.status === 'arrived' ? ' arrived' : ' accepted more than 2 minutes ago'}.
          </div>
        )}
        {canCancel && onCancel && perspective === 'customer' && ride.status === 'accepted' && ride.cancel_policy?.customer_fee === 0 && ride.cancel_policy?.grace_ends_at && (
          <div className="call-note">Free to cancel for a short while after the driver accepts; after that a late fee applies.</div>
        )}
        {canCancel && onCancel && perspective === 'driver' && ride.cancel_policy?.driver_penalty > 0 && (
          <div className="fee-warning">
            Cancelling now deducts <b>{signed(-ride.cancel_policy.driver_penalty, ride.currency)}</b> from your earnings.
          </div>
        )}
        {canCancel && onCancel && (
          <button className="btn btn-danger-ghost" disabled={busy} onClick={() => onCancel()}>
            Cancel ride
            {perspective === 'customer' && ride.cancel_policy?.customer_fee > 0 ? ` · ${signed(-ride.cancel_policy.customer_fee, ride.currency)}` : ''}
            {perspective === 'driver' && ride.cancel_policy?.driver_penalty > 0 ? ` · ${signed(-ride.cancel_policy.driver_penalty, ride.currency)}` : ''}
          </button>
        )}
      </div>

      {ride.status === 'completed' && (
        <div className="receipt">
          <h4>Receipt</h4>
          <Row label={`Base fare`} value={money(ride.fare_breakdown.base_fare, ride.currency)} />
          <Row
            label={`Distance · ${ride.fare_breakdown.distance_km} km × ${money(ride.fare_breakdown.per_km, ride.currency)}`}
            value={money(ride.fare_breakdown.distance_charge, ride.currency)}
          />
          <Row
            label={`Time · ${ride.fare_breakdown.duration_min} min × ${money(ride.fare_breakdown.per_min, ride.currency)}`}
            value={money(ride.fare_breakdown.time_charge, ride.currency)}
          />
          <Row label="Booking fee" value={money(ride.fare_breakdown.booking_fee, ride.currency)} />
          {ride.fare_breakdown.min_fare_applied && <Row label="Minimum fare applied" value={money(ride.fare_breakdown.min_fare, ride.currency)} />}
          <Row
            label={perspective === 'customer' ? 'You paid' : 'You earned'}
            value={signed((perspective === 'customer' ? -1 : 1) * (ride.fare_final ?? ride.fare_estimate), ride.currency)}
            bold
            signedValue
          />
          <Row label="Paid by" value={ride.payment_method} />

          {onRate && !alreadyRated && (
            <div className="rate">
              <p>Rate your {perspective === 'customer' ? 'driver' : 'rider'}</p>
              <div className="stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n} stars`}>
                    ★
                  </button>
                ))}
              </div>
              <button className="btn btn-primary" disabled={!stars || busy} onClick={() => onRate(stars)}>
                Submit rating
              </button>
            </div>
          )}
          {alreadyRated && <p className="muted">You rated this trip {alreadyRated} ★. Thanks!</p>}
        </div>
      )}

      {ride.status === 'cancelled' && (
        <div className="receipt">
          <h4>Outcome</h4>
          {perspective === 'customer' && (
            <Row label={ride.cancel_fee ? 'Late-cancellation fee' : 'No charge'} value={signed(-ride.cancel_fee, ride.currency)} signedValue />
          )}
          {perspective === 'driver' && ride.driver_penalty > 0 && <Row label="Penalty for cancelling after accepting" value={signed(-ride.driver_penalty, ride.currency)} signedValue />}
          {perspective === 'driver' && ride.cancel_fee > 0 && <Row label="Late-cancellation fee from rider" value={signed(ride.cancel_fee, ride.currency)} signedValue />}
          {perspective === 'driver' && !ride.driver_penalty && !ride.cancel_fee && <Row label="No money moved" value={signed(0, ride.currency)} signedValue />}
        </div>
      )}

      {(ride.status === 'completed' || ride.status === 'cancelled') && onDone && (
        <button className="btn btn-light" onClick={onDone}>
          {perspective === 'customer' ? 'Book another ride' : 'Back to requests'}
        </button>
      )}
    </div>
  );
}

function Row({ label, value, bold, signedValue }: { label: string; value: string; bold?: boolean; signedValue?: boolean }) {
  const n = signedValue ? (value.startsWith('+') ? 1 : value.startsWith('−') ? -1 : 0) : 0;
  return (
    <div className={`row ${bold ? 'row-bold' : ''}`}>
      <span>{label}</span>
      <span className={signedValue ? signedClass(n) : undefined}>{value}</span>
    </div>
  );
}

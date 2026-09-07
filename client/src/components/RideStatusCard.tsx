import { useState } from 'react';
import type { Ride } from '../lib/types';
import { STATUS_LABEL, km, mins, money, shortAddress, signed, signedClass } from '../lib/format';
import { api, apiBase } from '../lib/api';
import Comms from './Comms';

interface Props {
  ride: Ride;
  perspective: 'customer' | 'driver';
  etaMin?: number | null;
  dispatchNote?: string | null;
  onCancel?: (reason?: string) => Promise<void> | void;
  onAdvance?: (action: 'arrived' | 'start' | 'complete', opts?: { pin?: string }) => Promise<void> | void;
  onRate?: (stars: number) => Promise<void> | void;
  onDone?: () => void;
  busy?: boolean;
}

export default function RideStatusCard({ ride, perspective, etaMin, dispatchNote, onCancel, onAdvance, onRate, onDone, busy }: Props) {
  const [stars, setStars] = useState(0);
  const [pin, setPin] = useState('');
  const [sos, setSos] = useState<{ contacts: { name: string; phone: string }[]; share_url: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const other = perspective === 'customer' ? ride.driver : ride.customer;
  const canCancel = ['requested', 'accepted', 'arrived'].includes(ride.status);
  const alreadyRated = perspective === 'customer' ? ride.driver_rating : ride.customer_rating;
  const live = ['accepted', 'arrived', 'in_progress'].includes(ride.status);
  const shareUrl = `${apiBase() || window.location.origin}/t/${ride.share_token}`;

  async function raiseSos() {
    if (!window.confirm('Raise an emergency alert? Support is told at once and your contacts are shown for a one-tap call.')) return;
    try {
      const pos = await new Promise<GeolocationPosition | null>((res) =>
        navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 4000 }) : res(null),
      );
      const out = await api<{ contacts: { name: string; phone: string }[]; share_url: string | null }>('/safety/sos', {
        method: 'POST',
        body: { ride_id: ride.id, lat: pos?.coords.latitude, lng: pos?.coords.longitude },
      });
      setSos(out);
    } catch {
      setSos({ contacts: [], share_url: null });
    }
  }

  async function share() {
    const text = `Follow my SwiftRide trip: ${shareUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My SwiftRide trip', text, url: shareUrl });
        return;
      } catch {
        /* user dismissed */
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link:', shareUrl);
    }
  }

  return (
    <div className="card status-card">
      <div className="status-head">
        <div>
          <div className={`status-badge status-${ride.status}`}>{STATUS_LABEL[ride.status]}</div>
          <h3 className="status-title">
            {ride.status === 'requested' && perspective === 'customer' && (dispatchNote || 'Looking for nearby drivers…')}
            {ride.status === 'accepted' &&
              (perspective === 'customer'
                ? `${ride.driver?.name} is ${etaMin ? `${etaMin} min away` : 'heading to you'}`
                : 'Head to the pickup')}
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
            {ride.surge_multiplier > 1 ? ` · ×${ride.surge_multiplier}` : ''}
          </small>
        </div>
      </div>

      {ride.status === 'requested' && perspective === 'customer' && (
        <div className="progress-bar">
          <span />
        </div>
      )}

      {/* The PIN proves the rider is getting into the right car. Only the rider sees it. */}
      {perspective === 'customer' && ride.pin && ['accepted', 'arrived'].includes(ride.status) && (
        <div className="pin-box">
          <small>Give this PIN to your driver</small>
          <strong>{ride.pin}</strong>
        </div>
      )}
      {perspective === 'driver' && ride.pin_required && ride.status === 'arrived' && (
        <div className="pin-entry">
          <label>
            Rider&rsquo;s PIN
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="1234" maxLength={4} />
          </label>
          <small className="muted">Ask them to read out the four digits on their screen.</small>
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

      {other && live && <Comms ride={ride} />}

      {live && (
        <div className="safety-row">
          <button className="btn btn-light btn-sm" onClick={share}>
            {copied ? '✓ Link copied' : '🔗 Share trip'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={raiseSos}>
            🚨 SOS
          </button>
        </div>
      )}

      {sos && (
        <div className="sos-panel">
          <strong>Alert sent to support.</strong>
          {sos.contacts.length > 0 ? (
            <>
              <small>Call someone now:</small>
              <div className="row-actions">
                {sos.contacts.map((c) => (
                  <a key={c.phone} className="btn btn-light btn-sm" href={`tel:${c.phone}`}>
                    {c.name}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <small>Add emergency contacts on the Safety page so they appear here.</small>
          )}
          <a className="btn btn-light btn-sm" href="tel:112">
            Call emergency services (112)
          </a>
        </div>
      )}

      <div className="status-actions">
        {perspective === 'driver' && ride.status === 'accepted' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => onAdvance?.('arrived')}>
            I&rsquo;ve arrived
          </button>
        )}
        {perspective === 'driver' && ['accepted', 'arrived'].includes(ride.status) && (
          <button
            className="btn btn-primary"
            disabled={busy || (ride.pin_required && pin.length !== 4)}
            onClick={() => onAdvance?.('start', { pin })}
          >
            {ride.pin_required && pin.length !== 4 ? 'Enter the PIN to start' : 'Start trip'}
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
            Cancelling now deducts <b>{signed(-ride.cancel_policy.driver_penalty, ride.currency)}</b> from your earnings, and the rider
            goes back into the queue.
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
          <Row label="Base fare" value={money(ride.fare_breakdown.base_fare, ride.currency)} />
          <Row
            label={`Distance · ${ride.fare_breakdown.distance_km} km × ${money(ride.fare_breakdown.per_km, ride.currency)}${ride.surge_multiplier > 1 ? ` × ${ride.surge_multiplier}` : ''}`}
            value={money(ride.fare_breakdown.distance_charge, ride.currency)}
          />
          <Row
            label={`Time · ${ride.fare_breakdown.duration_min} min × ${money(ride.fare_breakdown.per_min, ride.currency)}${ride.surge_multiplier > 1 ? ` × ${ride.surge_multiplier}` : ''}`}
            value={money(ride.fare_breakdown.time_charge, ride.currency)}
          />
          <Row label="Booking fee" value={money(ride.fare_breakdown.booking_fee, ride.currency)} />
          {ride.fare_breakdown.min_fare_applied && <Row label="Minimum fare applied" value={money(ride.fare_breakdown.min_fare, ride.currency)} />}
          {ride.discount > 0 && <Row label={`Promo ${ride.promo_code || ''}`} value={signed(-ride.discount, ride.currency)} signedValue />}
          <Row
            label={perspective === 'customer' ? 'You paid' : 'Fare collected'}
            value={signed((perspective === 'customer' ? -1 : 1) * (ride.fare_final ?? ride.fare_estimate), ride.currency)}
            bold
            signedValue
          />
          <Row label="Paid by" value={`${ride.payment_method}${ride.payment_status === 'failed' ? ' (unpaid)' : ''}`} />
          {perspective === 'driver' && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Your share after commission is shown in Earnings and in your wallet.
            </p>
          )}

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
          {perspective === 'driver' && ride.driver_penalty > 0 && (
            <Row label="Penalty for cancelling after accepting" value={signed(-ride.driver_penalty, ride.currency)} signedValue />
          )}
          {perspective === 'driver' && ride.cancel_fee > 0 && (
            <Row label="Late-cancellation fee from rider" value={signed(ride.cancel_fee, ride.currency)} signedValue />
          )}
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

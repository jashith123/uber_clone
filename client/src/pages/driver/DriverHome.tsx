import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MapView, { type MapDriver } from '../../components/MapView';
import RideStatusCard from '../../components/RideStatusCard';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DEFAULT_CENTER, bearing, getCurrentPosition, haversineKm, lerp } from '../../lib/geo';
import { getSocket } from '../../lib/socket';
import { alreadyAsked, enablePush, pushPermission } from '../../lib/push';
import { km, mins, money, shortAddress } from '../../lib/format';
import type { Ride, RideOffer, User } from '../../lib/types';

type Pos = { lat: number; lng: number; heading: number | null };

/** Seconds left on an offer, recomputed every second. */
function useCountdown(iso: string | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const end = Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso.replace(' ', 'T')}Z`);
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [iso]);
  return left;
}

export default function DriverHome() {
  const { user, setUser } = useAuth();
  const online = Boolean(user?.driver?.is_online);
  const approval = user?.driver?.approval_status || 'approved';
  const [pos, setPos] = useState<Pos>(() => ({
    lat: user?.driver?.lat ?? DEFAULT_CENTER[0],
    lng: user?.driver?.lng ?? DEFAULT_CENTER[1],
    heading: user?.driver?.heading ?? 0,
  }));
  const [simulate, setSimulate] = useState(false);
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [ride, setRide] = useState<Ride | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushHint, setPushHint] = useState(false);
  const simStep = useRef(0);

  const active = ride && ['accepted', 'arrived', 'in_progress'].includes(ride.status) ? ride : null;

  // Initial: active ride + real location.
  useEffect(() => {
    api<{ ride: Ride | null }>('/rides/active').then((r) => r.ride && setRide(r.ride)).catch(() => {});
    getCurrentPosition().then((p) => {
      if (p) setPos({ lat: p[0], lng: p[1], heading: 0 });
      else setSimulate(true); // no GPS on this device: drive the demo car instead
    });
    setPushHint(pushPermission() === 'default' && !alreadyAsked());
  }, []);

  const loadOffers = useCallback(() => {
    api<{ rides: RideOffer[] }>('/rides/available').then((r) => setOffers(r.rides)).catch(() => {});
  }, []);

  // Realtime: offers arriving and expiring, ride updates.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onOffer = () => loadOffers();
    const onExpired = ({ ride_id }: { ride_id: number }) => setOffers((cur) => cur.filter((o) => o.id !== ride_id));
    const onClosed = ({ ride_id }: { ride_id: number }) => setOffers((cur) => cur.filter((o) => o.id !== ride_id));
    const onUpdate = (r: Ride) => setRide((cur) => (cur && cur.id === r.id ? r : cur));
    s.on('offer:new', onOffer);
    s.on('offer:expired', onExpired);
    s.on('offer:closed', onClosed);
    s.on('ride:update', onUpdate);
    return () => {
      s.off('offer:new', onOffer);
      s.off('offer:expired', onExpired);
      s.off('offer:closed', onClosed);
      s.off('ride:update', onUpdate);
    };
  }, [loadOffers]);

  useEffect(() => {
    if (!online || active) return;
    loadOffers();
    const t = window.setInterval(loadOffers, 8000);
    return () => window.clearInterval(t);
  }, [online, active, loadOffers]);

  // Real GPS while online.
  useEffect(() => {
    if (!online || simulate || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? null }),
      () => setSimulate(true),
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online, simulate]);

  // Simulated driving: towards pickup, then along the chosen route.
  useEffect(() => {
    if (!online || !simulate || !active) return;
    const t = window.setInterval(() => {
      setPos((cur) => {
        if (active.status === 'in_progress') {
          const g = active.route_geometry;
          simStep.current = Math.min(simStep.current + 3, g.length - 1);
          const next = { lat: g[simStep.current][0], lng: g[simStep.current][1] };
          return { ...next, heading: bearing(cur, next) };
        }
        const target = { lat: active.pickup_lat, lng: active.pickup_lng };
        const d = haversineKm(cur, target);
        if (d < 0.02) return cur;
        const next = lerp(cur, target, Math.min(1, 0.25 / d));
        return { ...next, heading: bearing(cur, next) };
      });
    }, 1200);
    return () => window.clearInterval(t);
  }, [online, simulate, active]);

  useEffect(() => {
    if (active?.status !== 'in_progress') simStep.current = 0;
  }, [active?.status]);

  // Push position to the server (which relays it, with an ETA, to the rider).
  useEffect(() => {
    if (!online) return;
    getSocket()?.emit('driver:location', pos);
  }, [pos, online]);

  async function toggleOnline() {
    setBusy(true);
    setError(null);
    try {
      const { user: u } = await api<{ user: User }>('/drivers/me/status', { method: 'POST', body: { online: !online } });
      setUser(u);
      if (!online) {
        getSocket()?.emit('driver:location', pos);
        if (pushPermission() === 'default') void enablePush();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<{ ride: Ride }>) {
    setBusy(true);
    setError(null);
    try {
      const { ride } = await fn();
      setRide(ride);
      setOffers((cur) => cur.filter((o) => o.id !== ride.id));
    } catch (e) {
      setError((e as Error).message);
      loadOffers();
    } finally {
      setBusy(false);
    }
  }

  async function decline(id: number) {
    setOffers((cur) => cur.filter((o) => o.id !== id));
    try {
      await api(`/rides/${id}/decline`, { method: 'POST' });
    } catch {
      loadOffers();
    }
  }

  const mapDrivers = useMemo<MapDriver[]>(() => [{ id: user?.id ?? 0, ...pos, active: true }], [pos, user?.id]);
  const shown = active ?? (offers[0] || null);
  const fitKey = shown ? `ride-${shown.id}-${shown.status}` : undefined;

  return (
    <div className="ride-layout">
      <aside className="panel">
        <div className="online-bar">
          <div>
            <strong>{online ? "You're online" : "You're offline"}</strong>
            <small>
              {user?.driver?.vehicle_type?.toUpperCase()} · {user?.driver?.plate || 'no plate'} · ★ {user?.driver?.rating?.toFixed(1)}
              {user?.driver?.acceptance_rate != null ? ` · ${Math.round(user.driver.acceptance_rate)}% accepted` : ''}
            </small>
          </div>
          <button className={`btn ${online ? 'btn-light' : 'btn-primary'}`} disabled={busy || Boolean(active) || approval !== 'approved'} onClick={toggleOnline}>
            {online ? 'Go offline' : 'Go online'}
          </button>
        </div>

        {approval !== 'approved' && (
          <div className="fee-warning">
            {approval === 'pending' ? 'Your documents are being reviewed. You cannot go online yet.' : 'Your application was rejected.'}{' '}
            <Link to="/drive/documents">Open documents</Link>
          </div>
        )}

        {pushHint && online && (
          <div className="hint-bar">
            <span>Turn on notifications so you hear about ride offers.</span>
            <button className="btn btn-primary btn-sm" onClick={async () => { await enablePush(); setPushHint(false); }}>
              Turn on
            </button>
            <button className="icon-btn" onClick={() => setPushHint(false)}>✕</button>
          </div>
        )}

        <label className="sim-toggle">
          <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} /> Simulate GPS (demo: the car drives itself)
        </label>
        {error && <div className="error">{error}</div>}

        {ride && (active || ride.status === 'completed' || ride.status === 'cancelled') ? (
          <RideStatusCard
            ride={ride}
            perspective="driver"
            busy={busy}
            onAdvance={(a, opts) => act(() => api(`/rides/${ride.id}/${a}`, { method: 'POST', body: opts }))}
            onCancel={() => act(() => api(`/rides/${ride.id}/cancel`, { method: 'POST', body: { reason: 'Driver unavailable' } }))}
            onRate={(stars) => act(() => api(`/rides/${ride.id}/rate`, { method: 'POST', body: { stars } }))}
            onDone={() => {
              setRide(null);
              loadOffers();
            }}
          />
        ) : !online ? (
          <p className="muted">Go online to start receiving ride offers for your vehicle class.</p>
        ) : (
          <>
            <h3 className="section-title">
              Ride offers <span className="muted">· {offers.length}</span>
            </h3>
            {offers.length === 0 && (
              <p className="muted">
                Waiting for an offer… <span className="pulse" />
                <br />
                <small>Requests go to the nearest free drivers first, so you only see rides you can actually reach.</small>
              </p>
            )}
            <ul className="request-list">
              {offers.map((o) => (
                <OfferCard key={o.id} offer={o} busy={busy} onAccept={() => act(() => api(`/rides/${o.id}/accept`, { method: 'POST' }))} onDecline={() => decline(o.id)} />
              ))}
            </ul>
          </>
        )}
      </aside>

      <MapView
        center={[pos.lat, pos.lng]}
        waypoints={shown ? shown.waypoints : []}
        routes={shown ? [{ index: 0, geometry: shown.route_geometry }] : []}
        selectedRoute={0}
        drivers={mapDrivers}
        fitKey={fitKey}
      />
    </div>
  );
}

function OfferCard({ offer, busy, onAccept, onDecline }: { offer: RideOffer; busy?: boolean; onAccept: () => void; onDecline: () => void }) {
  const left = useCountdown(offer.offer_expires_at);
  const total = 20;
  const pct = Math.max(0, Math.min(100, (left / total) * 100));

  return (
    <li className={`card request offer ${left <= 5 ? 'urgent' : ''}`}>
      <div className="offer-timer">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="request-head">
        <b>{money(offer.fare_estimate, offer.currency)}</b>
        <small>{left > 0 ? `${left}s to decide` : 'expiring…'}</small>
      </div>
      <ol className="trip-path compact">
        <li className="pickup">
          {shortAddress(offer.pickup_address)} <small>({km(offer.pickup_distance_km)} away)</small>
        </li>
        {offer.waypoints.slice(1, -1).map((w, i) => (
          <li key={i} className="stop">
            {shortAddress(w.address)}
          </li>
        ))}
        <li className="dropoff">{shortAddress(offer.dropoff_address)}</li>
      </ol>
      <div className="request-meta">
        <span>
          {km(offer.distance_km)} · {mins(offer.duration_min)} · {offer.customer?.name}
          {offer.surge_multiplier > 1 ? ` · ×${offer.surge_multiplier}` : ''}
          {` · ${offer.payment_method}`}
        </span>
      </div>
      <div className="offer-actions">
        <button className="btn btn-light btn-sm" disabled={busy} onClick={onDecline}>
          Decline
        </button>
        <button className="btn btn-primary" disabled={busy || left <= 0} onClick={onAccept}>
          Accept · {money(offer.fare_estimate, offer.currency)}
        </button>
      </div>
    </li>
  );
}

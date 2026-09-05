import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type MapDriver } from '../../components/MapView';
import RideStatusCard from '../../components/RideStatusCard';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DEFAULT_CENTER, bearing, getCurrentPosition, haversineKm, lerp } from '../../lib/geo';
import { getSocket } from '../../lib/socket';
import { km, mins, money, shortAddress, timeAgo } from '../../lib/format';
import type { Ride } from '../../lib/types';

type Pos = { lat: number; lng: number; heading: number | null };

export default function DriverHome() {
  const { user, setUser } = useAuth();
  const online = Boolean(user?.driver?.is_online);
  const [pos, setPos] = useState<Pos>(() => ({
    lat: user?.driver?.lat ?? DEFAULT_CENTER[0],
    lng: user?.driver?.lng ?? DEFAULT_CENTER[1],
    heading: user?.driver?.heading ?? 0,
  }));
  const [simulate, setSimulate] = useState(false);
  const [requests, setRequests] = useState<Ride[]>([]);
  const [preview, setPreview] = useState<Ride | null>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const simStep = useRef(0);

  const active = ride && ['accepted', 'arrived', 'in_progress'].includes(ride.status) ? ride : null;

  // Initial: active ride + real location.
  useEffect(() => {
    api<{ ride: Ride | null }>('/rides/active').then((r) => r.ride && setRide(r.ride)).catch(() => {});
    getCurrentPosition().then((p) => {
      if (p) setPos({ lat: p[0], lng: p[1], heading: 0 });
      else setSimulate(true); // no GPS on this device: drive the demo car instead
    });
  }, []);

  // Realtime: new requests, taken requests, ride updates.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = (r: Ride) => setRequests((cur) => (cur.some((x) => x.id === r.id) ? cur : [r, ...cur]));
    const onTaken = ({ id }: { id: number }) => setRequests((cur) => cur.filter((x) => x.id !== id));
    const onUpdate = (r: Ride) => setRide((cur) => (cur && cur.id === r.id ? r : cur));
    s.on('ride:new', onNew);
    s.on('ride:taken', onTaken);
    s.on('ride:update', onUpdate);
    return () => {
      s.off('ride:new', onNew);
      s.off('ride:taken', onTaken);
      s.off('ride:update', onUpdate);
    };
  }, []);

  const loadRequests = useCallback(() => {
    api<{ rides: Ride[] }>('/rides/available').then((r) => setRequests(r.rides)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!online) return;
    loadRequests();
    const t = window.setInterval(loadRequests, 10000);
    return () => window.clearInterval(t);
  }, [online, loadRequests]);

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

  // Push position to the server (which relays to the rider).
  useEffect(() => {
    if (!online) return;
    getSocket()?.emit('driver:location', pos);
  }, [pos, online]);

  async function toggleOnline() {
    setBusy(true);
    try {
      const { user: u } = await api<{ user: NonNullable<typeof user> }>('/drivers/me/status', { method: 'POST', body: { online: !online } });
      setUser(u);
      if (!online) getSocket()?.emit('driver:location', pos);
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
      setPreview(null);
      setRequests((cur) => cur.filter((x) => x.id !== ride.id));
    } catch (e) {
      setError((e as Error).message);
      loadRequests();
    } finally {
      setBusy(false);
    }
  }

  const shown = active ?? preview;
  const mapDrivers = useMemo<MapDriver[]>(() => [{ id: user?.id ?? 0, ...pos, active: true }], [pos, user?.id]);
  const fitKey = shown ? `ride-${shown.id}-${shown.status}` : undefined;

  return (
    <div className="ride-layout">
      <aside className="panel">
        <div className="online-bar">
          <div>
            <strong>{online ? "You're online" : "You're offline"}</strong>
            <small>
              {user?.driver?.vehicle_type?.toUpperCase()} · {user?.driver?.plate || 'no plate'} · ★ {user?.driver?.rating.toFixed(1)}
            </small>
          </div>
          <button className={`btn ${online ? 'btn-light' : 'btn-primary'}`} disabled={busy || Boolean(active)} onClick={toggleOnline}>
            {online ? 'Go offline' : 'Go online'}
          </button>
        </div>
        <label className="sim-toggle">
          <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} /> Simulate GPS (demo: car drives itself)
        </label>
        {error && <div className="error">{error}</div>}

        {ride && (active || ride.status === 'completed' || ride.status === 'cancelled') ? (
          <RideStatusCard
            ride={ride}
            perspective="driver"
            busy={busy}
            onAdvance={(a) => act(() => api(`/rides/${ride.id}/${a}`, { method: 'POST' }))}
            onCancel={() => act(() => api(`/rides/${ride.id}/cancel`, { method: 'POST', body: { reason: 'Driver unavailable' } }))}
            onRate={(stars) => act(() => api(`/rides/${ride.id}/rate`, { method: 'POST', body: { stars } }))}
            onDone={() => {
              setRide(null);
              loadRequests();
            }}
          />
        ) : !online ? (
          <p className="muted">Go online to start receiving ride requests for your vehicle class.</p>
        ) : (
          <>
            <h3 className="section-title">
              Ride requests <span className="muted">· {requests.length}</span>
            </h3>
            {requests.length === 0 && (
              <p className="muted">
                Waiting for requests… <span className="pulse" />
              </p>
            )}
            <ul className="request-list">
              {requests.map((r) => {
                const toPickup = haversineKm(pos, { lat: r.pickup_lat, lng: r.pickup_lng });
                return (
                  <li key={r.id} className={`card request ${preview?.id === r.id ? 'on' : ''}`} onClick={() => setPreview(r)}>
                    <div className="request-head">
                      <b>{money(r.fare_estimate, r.currency)}</b>
                      <small>{timeAgo(r.created_at)}</small>
                    </div>
                    <ol className="trip-path compact">
                      <li className="pickup">
                        {shortAddress(r.pickup_address)} <small>({km(toPickup)} away)</small>
                      </li>
                      {r.waypoints.slice(1, -1).map((w, i) => (
                        <li key={i} className="stop">
                          {shortAddress(w.address)}
                        </li>
                      ))}
                      <li className="dropoff">{shortAddress(r.dropoff_address)}</li>
                    </ol>
                    <div className="request-meta">
                      <span>
                        {km(r.distance_km)} · {mins(r.duration_min)} · {r.customer?.name}
                      </span>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          act(() => api(`/rides/${r.id}/accept`, { method: 'POST' }));
                        }}
                      >
                        Accept
                      </button>
                    </div>
                  </li>
                );
              })}
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

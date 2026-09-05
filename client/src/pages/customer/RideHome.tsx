import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type MapDriver } from '../../components/MapView';
import PlaceSearch from '../../components/PlaceSearch';
import RideStatusCard from '../../components/RideStatusCard';
import { api } from '../../lib/api';
import { DEFAULT_CENTER, getCurrentPosition } from '../../lib/geo';
import { getSocket } from '../../lib/socket';
import { km, mins, money, shortAddress } from '../../lib/format';
import type { DriverLocation, Place, Ride, RouteOption, Waypoint } from '../../lib/types';

type MapMode = 'pickup' | 'dropoff' | 'stop' | null;

export default function RideHome() {
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [pickup, setPickup] = useState<Waypoint | null>(null);
  const [dropoff, setDropoff] = useState<Waypoint | null>(null);
  const [stops, setStops] = useState<Waypoint[]>([]);
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');
  const [mapMode, setMapMode] = useState<MapMode>('pickup');
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [routeIndex, setRouteIndex] = useState(0);
  const [vehicle, setVehicle] = useState('economy');
  const [payment, setPayment] = useState<'cash' | 'card' | 'wallet'>('cash');
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ride, setRide] = useState<Ride | null>(null);
  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null);
  const [nearby, setNearby] = useState<MapDriver[]>([]);
  const [loaded, setLoaded] = useState(false);
  const routeReq = useRef(0);

  const waypoints = useMemo<Waypoint[]>(() => (pickup && dropoff ? [pickup, ...stops, dropoff] : [pickup, dropoff].filter(Boolean) as Waypoint[]), [pickup, dropoff, stops]);
  const selected = routes.find((r) => r.index === routeIndex) ?? routes[0];
  const quote = selected?.quotes.find((q) => q.vehicle_type === vehicle);

  // Initial load: geolocation + any ride already in progress.
  useEffect(() => {
    api<{ ride: Ride | null }>('/rides/active')
      .then((r) => r.ride && setRide(r.ride))
      .catch(() => {})
      .finally(() => setLoaded(true));
    // Geolocation is best-effort and must never block the UI.
    getCurrentPosition().then((pos) => pos && setCenter(pos));
  }, []);

  // Realtime updates for the ride I'm on.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onUpdate = (r: Ride) => setRide((cur) => (cur && cur.id === r.id ? r : cur));
    const onLoc = (l: DriverLocation) => setDriverLoc(l);
    s.on('ride:update', onUpdate);
    s.on('driver:location', onLoc);
    return () => {
      s.off('ride:update', onUpdate);
      s.off('driver:location', onLoc);
    };
  }, []);

  // Nearby cars while planning.
  useEffect(() => {
    if (ride) return;
    const [lat, lng] = pickup ? [pickup.lat, pickup.lng] : center;
    let stop = false;
    const load = () =>
      api<{ drivers: { user_id: number; lat: number; lng: number; heading: number | null }[] }>(`/drivers/nearby?lat=${lat}&lng=${lng}`)
        .then((r) => !stop && setNearby(r.drivers.map((d) => ({ id: d.user_id, lat: d.lat, lng: d.lng, heading: d.heading }))))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 8000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [center, pickup, ride]);

  // Fetch route options whenever the waypoint list changes.
  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoutes([]);
      return;
    }
    const id = ++routeReq.current;
    setRouting(true);
    setError(null);
    api<{ routes: RouteOption[] }>('/geo/routes', { method: 'POST', body: { waypoints: [pickup, ...stops, dropoff] } })
      .then((r) => {
        if (id !== routeReq.current) return;
        setRoutes(r.routes);
        setRouteIndex(0);
      })
      .catch((e) => id === routeReq.current && setError((e as Error).message))
      .finally(() => id === routeReq.current && setRouting(false));
  }, [pickup, dropoff, stops]);

  const reverse = useCallback(async (p: { lat: number; lng: number }): Promise<Waypoint> => {
    try {
      const { result } = await api<{ result: Place }>(`/geo/reverse?lat=${p.lat}&lng=${p.lng}`);
      return { lat: p.lat, lng: p.lng, address: result.label };
    } catch {
      return { lat: p.lat, lng: p.lng, address: null };
    }
  }, []);

  async function onMapClick(p: { lat: number; lng: number }) {
    if (ride || !mapMode) return;
    const wp = await reverse(p);
    if (mapMode === 'pickup') {
      setPickup(wp);
      setPickupText(shortAddress(wp.address));
      setMapMode(dropoff ? null : 'dropoff');
    } else if (mapMode === 'dropoff') {
      setDropoff(wp);
      setDropoffText(shortAddress(wp.address));
      setMapMode(null);
    } else {
      setStops((s) => [...s, wp]);
      setMapMode(null);
    }
  }

  async function onWaypointDrag(i: number, p: { lat: number; lng: number }) {
    const wp = await reverse(p);
    if (i === 0) {
      setPickup(wp);
      setPickupText(shortAddress(wp.address));
    } else if (i === waypoints.length - 1) {
      setDropoff(wp);
      setDropoffText(shortAddress(wp.address));
    } else {
      setStops((s) => s.map((x, j) => (j === i - 1 ? wp : x)));
    }
  }

  function selectPlace(kind: 'pickup' | 'dropoff', place: Place) {
    const wp: Waypoint = { lat: place.lat, lng: place.lng, address: place.label };
    if (kind === 'pickup') {
      setPickup(wp);
      setPickupText(place.name);
      if (!dropoff) setMapMode('dropoff');
    } else {
      setDropoff(wp);
      setDropoffText(place.name);
      setMapMode(null);
    }
  }

  async function useMyLocation() {
    const pos = await getCurrentPosition();
    if (!pos) return setError('Location permission denied. Click the map to set pickup.');
    const wp = await reverse({ lat: pos[0], lng: pos[1] });
    setPickup(wp);
    setPickupText(shortAddress(wp.address, 'Current location'));
    setCenter(pos);
    if (!dropoff) setMapMode('dropoff');
  }

  async function book() {
    if (!selected || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const { ride } = await api<{ ride: Ride }>('/rides', {
        method: 'POST',
        body: { waypoints, route_index: selected.index, vehicle_type: vehicle, payment_method: payment },
      });
      setRide(ride);
      setDriverLoc(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<{ ride: Ride }>) {
    setBusy(true);
    try {
      const { ride } = await fn();
      setRide(ride);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function resetPlan() {
    setRide(null);
    setDriverLoc(null);
    setPickup(null);
    setDropoff(null);
    setStops([]);
    setPickupText('');
    setDropoffText('');
    setRoutes([]);
    setMapMode('pickup');
    setError(null);
  }

  const mapDrivers: MapDriver[] = ride
    ? ride.driver && (driverLoc || ride.driver.lat != null)
      ? [{ id: ride.driver.id, lat: driverLoc?.lat ?? ride.driver.lat!, lng: driverLoc?.lng ?? ride.driver.lng!, heading: driverLoc?.heading ?? ride.driver.heading, active: true }]
      : []
    : nearby;

  const fitKey = ride ? `ride-${ride.id}` : routes.length ? `r-${routeIndex}-${routes.map((r) => r.geometry.length).join('.')}` : waypoints.length ? `w-${waypoints.map((w) => `${w.lat},${w.lng}`).join('|')}` : undefined;

  return (
    <div className="ride-layout">
      <aside className="panel">
        {!loaded ? (
          <p className="muted">Loading…</p>
        ) : ride ? (
          <RideStatusCard
            ride={ride}
            perspective="customer"
            busy={busy}
            onCancel={() => act(() => api(`/rides/${ride.id}/cancel`, { method: 'POST', body: { reason: 'Changed plans' } }))}
            onRate={(stars) => act(() => api(`/rides/${ride.id}/rate`, { method: 'POST', body: { stars } }))}
            onDone={resetPlan}
          />
        ) : (
          <>
            <h2 className="panel-title">Get a ride</h2>
            <div className="search-stack">
              <PlaceSearch
                icon="pickup"
                placeholder="Pickup location"
                value={pickupText}
                near={center}
                onChange={setPickupText}
                onSelect={(p) => selectPlace('pickup', p)}
                onFocus={() => setMapMode('pickup')}
                trailing={
                  <button type="button" className="icon-btn" title="Use my location" onClick={useMyLocation}>
                    ◎
                  </button>
                }
              />
              {stops.map((s, i) => (
                <div className="search-row stop-row" key={i}>
                  <span className="dot dot-stop">{i + 1}</span>
                  <span className="stop-label">{shortAddress(s.address)}</span>
                  <button type="button" className="icon-btn" title="Remove stop" onClick={() => setStops(stops.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <PlaceSearch
                icon="dropoff"
                placeholder="Where to?"
                value={dropoffText}
                near={center}
                onChange={setDropoffText}
                onSelect={(p) => selectPlace('dropoff', p)}
                onFocus={() => setMapMode('dropoff')}
              />
            </div>

            <div className="map-hint">
              {mapMode === 'pickup' && 'Click the map to set your pickup point.'}
              {mapMode === 'dropoff' && 'Click the map to set your destination.'}
              {mapMode === 'stop' && 'Click the map where you want to pass through.'}
              {mapMode === null && pickup && dropoff && 'Drag any pin to fine-tune. Grey lines are alternative routes.'}
              {mapMode === null && !(pickup && dropoff) && 'Search or click the map.'}
            </div>

            {pickup && dropoff && (
              <div className="route-tools">
                <button type="button" className={`btn btn-light btn-sm ${mapMode === 'stop' ? 'on' : ''}`} disabled={stops.length >= 5} onClick={() => setMapMode(mapMode === 'stop' ? null : 'stop')}>
                  + Add a stop / via point
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const p = pickup; setPickup(dropoff); setDropoff(p); const t = pickupText; setPickupText(dropoffText); setDropoffText(t); }}>
                  ⇅ Swap
                </button>
              </div>
            )}

            {error && <div className="error">{error}</div>}
            {routing && <p className="muted">Finding routes…</p>}

            {routes.length > 0 && !routing && (
              <>
                <h3 className="section-title">
                  Choose your route <span className="muted">· fare follows the km</span>
                </h3>
                <ul className="route-list">
                  {routes.map((r) => {
                    const fastest = routes.every((o) => o.duration_min >= r.duration_min);
                    const shortest = routes.every((o) => o.distance_km >= r.distance_km);
                    const q = r.quotes.find((x) => x.vehicle_type === vehicle);
                    return (
                      <li key={r.index} className={r.index === routeIndex ? 'on' : ''} onClick={() => setRouteIndex(r.index)}>
                        <div>
                          <strong>
                            {stops.length ? 'Your route' : `Route ${String.fromCharCode(65 + r.index)}`}
                            {fastest && <span className="tag">Fastest</span>}
                            {shortest && routes.length > 1 && <span className="tag">Shortest</span>}
                          </strong>
                          <small>
                            {km(r.distance_km)} · {mins(r.duration_min)}
                            {stops.length ? ` · ${stops.length} stop${stops.length > 1 ? 's' : ''}` : ''}
                          </small>
                        </div>
                        <b>{q ? money(q.fare, q.currency) : ''}</b>
                      </li>
                    );
                  })}
                </ul>

                <h3 className="section-title">Choose a ride</h3>
                <ul className="vehicle-list">
                  {selected?.quotes.map((q) => (
                    <li key={q.vehicle_type} className={q.vehicle_type === vehicle ? 'on' : ''} onClick={() => setVehicle(q.vehicle_type)}>
                      <span className={`veh veh-${q.vehicle_type}`} />
                      <div>
                        <strong>
                          {q.label} <small>👤 {q.seats}</small>
                        </strong>
                        <small>{q.description}</small>
                      </div>
                      <b>{money(q.fare, q.currency)}</b>
                    </li>
                  ))}
                </ul>

                {quote && (
                  <div className="fare-formula">
                    {money(quote.breakdown.base_fare, quote.currency)} base + {money(quote.breakdown.per_km, quote.currency)}/km × {quote.breakdown.distance_km} km +{' '}
                    {money(quote.breakdown.per_min, quote.currency)}/min × {quote.breakdown.duration_min} min + {money(quote.breakdown.booking_fee, quote.currency)} fee
                    {quote.breakdown.min_fare_applied ? ` (min fare ${money(quote.breakdown.min_fare, quote.currency)})` : ''} ={' '}
                    <b>{money(quote.fare, quote.currency)}</b>
                  </div>
                )}

                <div className="payment-row">
                  <span>Pay with</span>
                  <div className="segmented small">
                    {(['cash', 'card', 'wallet'] as const).map((p) => (
                      <button key={p} type="button" className={payment === p ? 'on' : ''} onClick={() => setPayment(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <button className="btn btn-primary btn-block btn-lg" disabled={busy || !quote} onClick={book}>
                  {busy ? 'Requesting…' : `Confirm ${quote?.label} · ${quote ? money(quote.fare, quote.currency) : ''}`}
                </button>
              </>
            )}
          </>
        )}
      </aside>

      <MapView
        center={center}
        waypoints={ride ? ride.waypoints : waypoints}
        routes={ride ? [{ index: 0, geometry: ride.route_geometry }] : routes}
        selectedRoute={ride ? 0 : routeIndex}
        drivers={mapDrivers}
        draggable={!ride}
        onMapClick={onMapClick}
        onWaypointDrag={onWaypointDrag}
        onRouteClick={setRouteIndex}
        fitKey={fitKey}
      />
    </div>
  );
}

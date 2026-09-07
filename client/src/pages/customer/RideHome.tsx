import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type MapDriver } from '../../components/MapView';
import PlaceSearch from '../../components/PlaceSearch';
import RideStatusCard from '../../components/RideStatusCard';
import { api } from '../../lib/api';
import { DEFAULT_CENTER, getCurrentPosition } from '../../lib/geo';
import { getSocket } from '../../lib/socket';
import { alreadyAsked, enablePush, pushPermission } from '../../lib/push';
import { km, mins, money, shortAddress } from '../../lib/format';
import type { DispatchSearching, DriverLocation, Place, Promo, PromoCheck, Ride, RouteOption, Wallet, Waypoint } from '../../lib/types';

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
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<string | null>(null);
  const [promoCheck, setPromoCheck] = useState<PromoCheck | null>(null);
  const [offers, setOffers] = useState<Promo[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ride, setRide] = useState<Ride | null>(null);
  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null);
  const [dispatchNote, setDispatchNote] = useState<string | null>(null);
  const [nearby, setNearby] = useState<MapDriver[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pushHint, setPushHint] = useState(false);
  const routeReq = useRef(0);

  const waypoints = useMemo<Waypoint[]>(
    () => (pickup && dropoff ? [pickup, ...stops, dropoff] : ([pickup, dropoff].filter(Boolean) as Waypoint[])),
    [pickup, dropoff, stops],
  );
  const selected = routes.find((r) => r.index === routeIndex) ?? routes[0];
  const quote = selected?.quotes.find((q) => q.vehicle_type === vehicle);

  // Initial load. Geolocation is deliberately NOT awaited here: the browser can
  // take several seconds (or never answer), and the panel must not sit blank.
  useEffect(() => {
    void (async () => {
      const [active, w, p] = await Promise.all([
        api<{ ride: Ride | null }>('/rides/active').catch(() => ({ ride: null })),
        api<{ wallet: Wallet }>('/payments/wallet').catch(() => null),
        api<{ promos: Promo[] }>('/geo/promos').catch(() => ({ promos: [] })),
      ]);
      if (active.ride) setRide(active.ride);
      if (w) setWallet(w.wallet);
      setOffers(p.promos);
      setLoaded(true);
      setPushHint(pushPermission() === 'default' && !alreadyAsked());
    })();
    // Recentre the map if and when the browser gives us a position.
    void getCurrentPosition().then((pos) => pos && setCenter(pos));
  }, []);

  // Realtime updates for the ride I'm on.
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onUpdate = (r: Ride) => {
      setRide((cur) => (cur && cur.id === r.id ? r : cur));
      if (r.status !== 'requested') setDispatchNote(null);
    };
    const onLoc = (l: DriverLocation) => setDriverLoc(l);
    const onSearching = (d: DispatchSearching) =>
      setDispatchNote(d.offered_to ? `Asking ${d.offered_to} nearby driver${d.offered_to > 1 ? 's' : ''}…` : 'Widening the search…');
    const onNone = () => setDispatchNote('No drivers free nearby right now.');
    s.on('ride:update', onUpdate);
    s.on('driver:location', onLoc);
    s.on('dispatch:searching', onSearching);
    s.on('dispatch:none', onNone);
    return () => {
      s.off('ride:update', onUpdate);
      s.off('driver:location', onLoc);
      s.off('dispatch:searching', onSearching);
      s.off('dispatch:none', onNone);
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

  // Fetch route options whenever the waypoints or the promo change.
  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoutes([]);
      return;
    }
    const id = ++routeReq.current;
    setRouting(true);
    setError(null);
    api<{ routes: RouteOption[]; promo: PromoCheck | null }>('/geo/routes', {
      method: 'POST',
      body: { waypoints: [pickup, ...stops, dropoff], promo_code: promoApplied },
    })
      .then((r) => {
        if (id !== routeReq.current) return;
        setRoutes(r.routes);
        setRouteIndex(0);
        setPromoCheck(r.promo);
        if (r.promo && !r.promo.ok) setPromoApplied(null);
      })
      .catch((e) => id === routeReq.current && setError((e as Error).message))
      .finally(() => id === routeReq.current && setRouting(false));
  }, [pickup, dropoff, stops, promoApplied]);

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
    if (!pos) return setError('Location permission denied. Tap the map to set pickup.');
    const wp = await reverse({ lat: pos[0], lng: pos[1] });
    setPickup(wp);
    setPickupText(shortAddress(wp.address, 'Current location'));
    setCenter(pos);
    if (!dropoff) setMapMode('dropoff');
  }

  async function book() {
    if (!selected || !quote) return;
    if (payment === 'wallet' && wallet && wallet.balance < quote.fare) {
      setError(`Your wallet has ${money(wallet.balance)} but the fare is ${money(quote.fare)}. Add money or pay by cash.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { ride } = await api<{ ride: Ride }>('/rides', {
        method: 'POST',
        body: { waypoints, route_index: selected.index, vehicle_type: vehicle, payment_method: payment, promo_code: promoApplied },
      });
      setRide(ride);
      setDriverLoc(null);
      setDispatchNote('Looking for nearby drivers…');
      if (pushPermission() === 'default') void enablePush();
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
      api<{ wallet: Wallet }>('/payments/wallet').then((w) => setWallet(w.wallet)).catch(() => {});
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
    setDispatchNote(null);
  }

  const mapDrivers: MapDriver[] = ride
    ? ride.driver && (driverLoc || ride.driver.lat != null)
      ? [
          {
            id: ride.driver.id,
            lat: driverLoc?.lat ?? ride.driver.lat!,
            lng: driverLoc?.lng ?? ride.driver.lng!,
            heading: driverLoc?.heading ?? ride.driver.heading,
            active: true,
          },
        ]
      : []
    : nearby;

  const fitKey = ride
    ? `ride-${ride.id}`
    : routes.length
      ? `r-${routeIndex}-${routes.map((r) => r.geometry.length).join('.')}`
      : waypoints.length
        ? `w-${waypoints.map((w) => `${w.lat},${w.lng}`).join('|')}`
        : undefined;

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
            etaMin={driverLoc?.eta_min ?? ride.driver_eta_min}
            dispatchNote={dispatchNote}
            onCancel={() => act(() => api(`/rides/${ride.id}/cancel`, { method: 'POST', body: { reason: 'Changed plans' } }))}
            onRate={(stars) => act(() => api(`/rides/${ride.id}/rate`, { method: 'POST', body: { stars } }))}
            onDone={resetPlan}
          />
        ) : (
          <>
            <h2 className="panel-title">Get a ride</h2>

            {pushHint && (
              <div className="hint-bar">
                <span>Turn on notifications so you know the moment a driver accepts.</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={async () => {
                    await enablePush();
                    setPushHint(false);
                  }}
                >
                  Turn on
                </button>
                <button className="icon-btn" onClick={() => setPushHint(false)}>✕</button>
              </div>
            )}

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
              {mapMode === 'pickup' && 'Tap the map to set your pickup point.'}
              {mapMode === 'dropoff' && 'Tap the map to set your destination.'}
              {mapMode === 'stop' && 'Tap the map where you want to pass through.'}
              {mapMode === null && pickup && dropoff && 'Drag any pin to fine-tune. Grey lines are alternative routes.'}
              {mapMode === null && !(pickup && dropoff) && 'Search or tap the map.'}
            </div>

            {pickup && dropoff && (
              <div className="route-tools">
                <button
                  type="button"
                  className={`btn btn-light btn-sm ${mapMode === 'stop' ? 'on' : ''}`}
                  disabled={stops.length >= 5}
                  onClick={() => setMapMode(mapMode === 'stop' ? null : 'stop')}
                >
                  + Add a stop / via point
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const p = pickup;
                    setPickup(dropoff);
                    setDropoff(p);
                    const t = pickupText;
                    setPickupText(dropoffText);
                    setDropoffText(t);
                  }}
                >
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
                          {q.surge_multiplier > 1 && <span className="tag tag-surge">×{q.surge_multiplier}</span>}
                        </strong>
                        <small>{q.description}</small>
                      </div>
                      <b>{money(q.fare, q.currency)}</b>
                    </li>
                  ))}
                </ul>

                {quote?.surge_reason && <div className="surge-note">⚡ {quote.surge_reason}. Prices are higher than usual.</div>}

                {/* ------------------------------ promo ------------------------------ */}
                <div className="promo-box">
                  {promoApplied && promoCheck?.ok ? (
                    <div className="promo-applied">
                      <span>
                        <strong>{promoApplied}</strong> applied · you save {money(quote?.breakdown.discount ?? 0)}
                      </span>
                      <button className="icon-btn" onClick={() => setPromoApplied(null)}>✕</button>
                    </div>
                  ) : (
                    <>
                      <div className="search-row">
                        <span className="dot dot-stop">%</span>
                        <input
                          className="search-input"
                          placeholder="Promo code"
                          value={promoInput}
                          onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        />
                        <button className="btn btn-light btn-sm" disabled={!promoInput.trim()} onClick={() => setPromoApplied(promoInput.trim())}>
                          Apply
                        </button>
                      </div>
                      {promoCheck && !promoCheck.ok && <div className="error">{promoCheck.reason}</div>}
                      {offers.length > 0 && (
                        <div className="chip-row">
                          {offers.slice(0, 3).map((o) => (
                            <button
                              key={o.code}
                              className="chip"
                              title={o.description}
                              onClick={() => {
                                setPromoInput(o.code);
                                setPromoApplied(o.code);
                              }}
                            >
                              {o.code}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {quote && (
                  <div className="fare-formula">
                    {money(quote.breakdown.base_fare, quote.currency)} base + {money(quote.breakdown.per_km, quote.currency)}/km ×{' '}
                    {quote.breakdown.distance_km} km + {money(quote.breakdown.per_min, quote.currency)}/min × {quote.breakdown.duration_min} min +{' '}
                    {money(quote.breakdown.booking_fee, quote.currency)} fee
                    {quote.surge_multiplier > 1 ? ` (×${quote.surge_multiplier} demand)` : ''}
                    {quote.breakdown.min_fare_applied ? ` (min fare ${money(quote.breakdown.min_fare, quote.currency)})` : ''}
                    {quote.breakdown.discount > 0 ? ` − ${money(quote.breakdown.discount, quote.currency)} promo` : ''} ={' '}
                    <b>{money(quote.fare, quote.currency)}</b>
                  </div>
                )}

                <div className="payment-row">
                  <span>Pay with</span>
                  <div className="segmented small">
                    {(['cash', 'wallet', 'card'] as const).map((p) => (
                      <button key={p} type="button" className={payment === p ? 'on' : ''} onClick={() => setPayment(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {payment === 'wallet' && (
                  <div className={`call-note ${wallet && quote && wallet.balance < quote.fare ? 'error' : ''}`}>
                    Wallet balance {money(wallet?.balance ?? 0)}
                    {wallet && quote && wallet.balance < quote.fare ? ' — not enough for this ride.' : ''}
                  </div>
                )}

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

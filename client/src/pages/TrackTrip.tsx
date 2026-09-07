import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import MapView from '../components/MapView';
import { STATUS_LABEL, km, mins, shortAddress } from '../lib/format';
import { apiBase } from '../lib/api';
import type { PublicTrip } from '../lib/types';

/**
 * Public trip tracking. No login: anyone with the link can follow the ride.
 * Deliberately shows no phone numbers and only the rider's first name.
 */
export default function TrackTrip() {
  const { token } = useParams();
  const [trip, setTrip] = useState<PublicTrip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`${apiBase()}/api/safety/trip/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Trip not found');
        if (!stop) setTrip(data.trip);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [token]);

  if (error) {
    return (
      <main className="page narrow">
        <h1>Trip not found</h1>
        <p className="muted">{error} The link may have been mistyped.</p>
      </main>
    );
  }
  if (!trip) return <div className="center muted">Loading trip…</div>;

  const live = ['accepted', 'arrived', 'in_progress'].includes(trip.status);

  return (
    <div className="ride-layout">
      <aside className="panel">
        <div className="card status-card">
          <div>
            <div className={`status-badge status-${trip.status}`}>{STATUS_LABEL[trip.status]}</div>
            <h2 className="status-title">{trip.rider}&rsquo;s trip</h2>
            <p className="muted">
              {live ? 'Following live. This page refreshes on its own.' : 'This trip has ended.'}
            </p>
          </div>

          <ol className="trip-path">
            {trip.waypoints.map((w, i) => (
              <li key={i} className={i === 0 ? 'pickup' : i === trip.waypoints.length - 1 ? 'dropoff' : 'stop'}>
                {shortAddress(w.address, `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}`)}
              </li>
            ))}
          </ol>

          <div className="row">
            <span>Distance</span>
            <span>{km(trip.distance_km)}</span>
          </div>
          <div className="row">
            <span>Estimated time</span>
            <span>{mins(trip.duration_min)}</span>
          </div>

          {trip.driver && (
            <div className="party">
              <span className="avatar avatar-lg">{trip.driver.name.slice(0, 1)}</span>
              <div>
                <strong>{trip.driver.name}</strong>
                <small>
                  {trip.driver.vehicle || 'Vehicle'} · <b>{trip.driver.plate || '—'}</b> · ★ {trip.driver.rating?.toFixed(1)}
                </small>
              </div>
            </div>
          )}

          <p className="muted" style={{ fontSize: 13 }}>
            Shared from SwiftRide. Only the route and the driver&rsquo;s vehicle are visible; no phone numbers are shown.
          </p>
        </div>
      </aside>

      <MapView
        center={[trip.waypoints[0].lat, trip.waypoints[0].lng]}
        waypoints={trip.waypoints}
        routes={[{ index: 0, geometry: trip.route_geometry }]}
        selectedRoute={0}
        drivers={trip.driver?.lat != null ? [{ id: 1, lat: trip.driver.lat, lng: trip.driver.lng!, heading: trip.driver.heading, active: true }] : []}
        fitKey={`track-${trip.id}`}
      />
    </div>
  );
}

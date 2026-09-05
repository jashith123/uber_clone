import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { Waypoint } from '../lib/types';

export interface MapDriver {
  id: number;
  lat: number;
  lng: number;
  heading?: number | null;
  active?: boolean;
}

interface Props {
  center: [number, number];
  waypoints?: Waypoint[];
  routes?: { index: number; geometry: [number, number][] }[];
  selectedRoute?: number;
  drivers?: MapDriver[];
  onMapClick?: (latlng: { lat: number; lng: number }) => void;
  onWaypointDrag?: (i: number, latlng: { lat: number; lng: number }) => void;
  onRouteClick?: (index: number) => void;
  draggable?: boolean;
  fitKey?: string;
  className?: string;
}

const pinIcon = (kind: 'pickup' | 'stop' | 'dropoff', label?: string) =>
  L.divIcon({
    className: 'pin-wrap',
    html: `<div class="pin pin-${kind}">${label ?? ''}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const carIcon = (heading: number | null | undefined, active?: boolean) =>
  L.divIcon({
    className: 'pin-wrap',
    html: `<div class="car ${active ? 'car-active' : ''}" style="transform:rotate(${heading ?? 0}deg)">
      <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M12 2c-1.2 0-2.6.5-3.4 1.2C7.8 3.9 7 5.4 7 7v10.5c0 1.4 1.1 2.5 2.5 2.5h5c1.4 0 2.5-1.1 2.5-2.5V7c0-1.6-.8-3.1-1.6-3.8C14.6 2.5 13.2 2 12 2zm-3 7 1-2.5h4L15 9H9zm0 4h6v2H9v-2z"/></svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function ClickHandler({ onClick }: { onClick?: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 14));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);
  return null;
}

export default function MapView({
  center,
  waypoints = [],
  routes = [],
  selectedRoute = 0,
  drivers = [],
  onMapClick,
  onWaypointDrag,
  onRouteClick,
  draggable = false,
  fitKey,
  className,
}: Props) {
  const fitPoints = useMemo<[number, number][]>(() => {
    const sel = routes.find((r) => r.index === selectedRoute) ?? routes[0];
    if (sel) return sel.geometry;
    return waypoints.map((w) => [w.lat, w.lng]);
  }, [routes, selectedRoute, waypoints]);

  return (
    <MapContainer center={center} zoom={13} zoomControl={false} className={className ?? 'map'} attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onClick={onMapClick} />
      {fitKey ? <FitBounds points={fitPoints} fitKey={fitKey} /> : <Recenter center={center} />}

      {routes
        .filter((r) => r.index !== selectedRoute)
        .map((r) => (
          <Polyline
            key={`alt-${r.index}`}
            positions={r.geometry}
            pathOptions={{ color: '#9aa5b1', weight: 5, opacity: 0.85 }}
            eventHandlers={{ click: () => onRouteClick?.(r.index) }}
          />
        ))}
      {routes
        .filter((r) => r.index === selectedRoute)
        .map((r) => (
          <Polyline key={`sel-${r.index}`} positions={r.geometry} pathOptions={{ color: '#0e7c66', weight: 6, opacity: 0.95 }} />
        ))}

      {waypoints.map((w, i) => {
        const kind = i === 0 ? 'pickup' : i === waypoints.length - 1 ? 'dropoff' : 'stop';
        return (
          <Marker
            key={`wp-${i}-${w.lat}-${w.lng}`}
            position={[w.lat, w.lng]}
            icon={pinIcon(kind, kind === 'stop' ? String(i) : undefined)}
            draggable={draggable}
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onWaypointDrag?.(i, { lat: ll.lat, lng: ll.lng });
              },
            }}
          />
        );
      })}

      {drivers.map((d) => (
        <Marker key={`drv-${d.id}`} position={[d.lat, d.lng]} icon={carIcon(d.heading, d.active)} interactive={false} />
      ))}
    </MapContainer>
  );
}

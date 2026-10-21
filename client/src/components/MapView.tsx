import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import CarMarker from './CarMarker';
import L from 'leaflet';
import type { Waypoint } from '../lib/types';

export interface MapDriver {
  id: number;
  lat: number;
  lng: number;
  heading?: number | null;
  active?: boolean;
  vehicle_type?: string | null;
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
            pathOptions={{ color: '#9aa0a6', weight: 5, opacity: 0.8 }}
            eventHandlers={{ click: () => onRouteClick?.(r.index) }}
          />
        ))}
      {routes
        .filter((r) => r.index === selectedRoute)
        .map((r) => (
          <Polyline key={`sel-${r.index}`} positions={r.geometry} pathOptions={{ color: '#000', weight: 5 }} />
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
        <CarMarker key={`drv-${d.id}`} lat={d.lat} lng={d.lng} heading={d.heading} active={d.active} vehicleType={d.vehicle_type} />
      ))}
    </MapContainer>
  );
}

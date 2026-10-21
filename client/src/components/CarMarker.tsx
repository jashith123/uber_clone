import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

interface Props {
  lat: number;
  lng: number;
  heading?: number | null;
  active?: boolean;
}

// Top-down car: body, two windows, wheels, head and tail lights. Points up (north);
// the wrapper is rotated to the heading.
const CAR_SVG = `<svg viewBox="0 0 24 40" width="22" height="36" aria-hidden="true">
  <rect class="car-body-fill" x="3" y="2" width="18" height="36" rx="6"/>
  <rect x="1.5" y="9" width="2.5" height="7" rx="1" fill="#2b2b2b"/><rect x="20" y="9" width="2.5" height="7" rx="1" fill="#2b2b2b"/>
  <rect x="1.5" y="26" width="2.5" height="7" rx="1" fill="#2b2b2b"/><rect x="20" y="26" width="2.5" height="7" rx="1" fill="#2b2b2b"/>
  <rect x="5.5" y="8" width="13" height="8" rx="2.5" fill="#9fd0ff"/>
  <rect x="5.5" y="25" width="13" height="6" rx="2" fill="#9fd0ff" opacity=".85"/>
  <rect x="6" y="2.5" width="4" height="2" rx="1" fill="#ffe08a"/><rect x="14" y="2.5" width="4" height="2" rx="1" fill="#ffe08a"/>
  <rect x="6" y="35.5" width="4" height="2" rx="1" fill="#ff6b6b"/><rect x="14" y="35.5" width="4" height="2" rx="1" fill="#ff6b6b"/>
</svg>`;

function bearing(a: L.LatLng, b: L.LatLng): number | null {
  if (a.equals(b)) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * A car that glides between position updates instead of jumping, and turns
 * through the shortest angle. Each update is animated over roughly the time
 * since the previous one, so the car reaches the new fix just as the next lands.
 */
export default function CarMarker({ lat, lng, heading, active }: Props) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  const raf = useRef<number | null>(null);
  const lastUpdate = useRef(0);
  const curHeading = useRef<number>(heading ?? 0);

  useEffect(() => {
    const icon = L.divIcon({
      className: 'car-wrap',
      html: `<div class="car-marker ${active ? 'car-active' : ''}"><div class="car-body" style="transform:rotate(${curHeading.current}deg)">${CAR_SVG}</div></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    const m = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 500, keyboard: false }).addTo(map);
    marker.current = m;
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      m.remove();
      marker.current = null;
    };
    // The marker is created once per map/active state; position and heading are animated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active]);

  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    const from = m.getLatLng();
    const to = L.latLng(lat, lng);
    const now = performance.now();
    const dur = Math.min(2500, Math.max(350, lastUpdate.current ? now - lastUpdate.current : 800));
    lastUpdate.current = now;

    const fromH = curHeading.current;
    const wanted = heading ?? bearing(from, to);
    const toH = wanted == null || from.equals(to) ? fromH : wanted;
    const delta = ((toH - fromH + 540) % 360) - 180; // shortest turn

    if (raf.current) cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - now) / dur);
      const e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k; // ease in-out
      m.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
      const h = fromH + delta * e;
      curHeading.current = h;
      const el = m.getElement()?.querySelector<HTMLElement>('.car-body');
      if (el) el.style.transform = `rotate(${h}deg)`;
      raf.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  }, [lat, lng, heading]);

  return null;
}

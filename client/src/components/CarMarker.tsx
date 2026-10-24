import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

interface Props {
  lat: number;
  lng: number;
  heading?: number | null;
  active?: boolean;
  /** bike | auto | economy | comfort | xl — picks the silhouette. */
  vehicleType?: string | null;
}

/**
 * Flat top-down vehicle silhouettes, the way Uber draws cars on its map: one
 * solid colour (the app's primary, via currentColor), grey glass, no shading,
 * and a thin white halo so the shape stays readable over dark roads. Each
 * class keeps its own outline — scooter, three-wheeler, hatchback, sedan,
 * SUV — so a rider can still tell them apart. All point north (up); the
 * wrapper is rotated to the heading. Drawn on a 32×64 canvas.
 */
const GLASS = '#8d9196';

/** The silhouette is drawn twice: a white, thickened copy underneath, then the solid body. */
function silhouette(id: string, shapes: string, glass: string) {
  return `<svg viewBox="0 0 32 64" width="22" height="44" aria-hidden="true">
    <defs><g id="${id}">${shapes}</g></defs>
    <use href="#${id}" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <use href="#${id}" fill="currentColor"/>
    ${glass}
  </svg>`;
}

/** Hatchback (Go): compact, rounded. */
function hatchback(id: string) {
  return silhouette(
    id,
    `<path d="M8 8 Q8 3 13 3 L19 3 Q24 3 24 8 L24 57 Q24 61 20 61 L12 61 Q8 61 8 57 Z"/>
     <rect x="4.5" y="22" width="3.5" height="2.6" rx="1"/><rect x="24" y="22" width="3.5" height="2.6" rx="1"/>`,
    `<path d="M10.5 19 Q16 15.5 21.5 19 L20.8 26 L11.2 26 Z" fill="${GLASS}"/>
     <path d="M11 44 L21 44 L21.5 51 Q16 54 10.5 51 Z" fill="${GLASS}"/>`,
  );
}

/** Sedan (Comfort): longer, with a boot. */
function sedan(id: string) {
  return silhouette(
    id,
    `<path d="M7 9 Q7 3 13 3 L19 3 Q25 3 25 9 L25 57 Q25 61 21 61 L11 61 Q7 61 7 57 Z"/>
     <rect x="3.5" y="21" width="3.5" height="2.6" rx="1"/><rect x="25" y="21" width="3.5" height="2.6" rx="1"/>`,
    `<path d="M9.5 18 Q16 14.5 22.5 18 L21.6 26 L10.4 26 Z" fill="${GLASS}"/>
     <rect x="10.4" y="26.8" width="11.2" height="12" fill="${GLASS}" opacity=".55"/>
     <path d="M10.4 40 L21.6 40 L22.3 47 Q16 50 9.7 47 Z" fill="${GLASS}"/>`,
  );
}

/** SUV (XL): wide and boxy, three side windows. */
function suv(id: string) {
  return silhouette(
    id,
    `<path d="M6 8 Q6 3 11 3 L21 3 Q26 3 26 8 L26 58 Q26 61 23 61 L9 61 Q6 61 6 58 Z"/>
     <rect x="2.5" y="20" width="3.5" height="2.8" rx="1"/><rect x="26" y="20" width="3.5" height="2.8" rx="1"/>`,
    `<path d="M8.5 16 Q16 13 23.5 16 L23 24 L9 24 Z" fill="${GLASS}"/>
     <rect x="9" y="25" width="14" height="22" fill="${GLASS}" opacity=".55"/>
     <path d="M9 49 L23 49 L23.5 55 Q16 57.5 8.5 55 Z" fill="${GLASS}"/>`,
  );
}

/** Scooter (Moto) with a rider; the helmet is the grey circle. */
function scooter(id: string) {
  return silhouette(
    id,
    `<rect x="14" y="3" width="4" height="12" rx="2"/>
     <rect x="7" y="13" width="18" height="3" rx="1.5"/>
     <path d="M11 16 L21 16 L22 29 L10 29 Z"/>
     <rect x="9.5" y="28" width="13" height="23" rx="6"/>
     <rect x="14" y="49" width="4" height="12" rx="2"/>`,
    `<circle cx="16" cy="36" r="5" fill="${GLASS}"/>`,
  );
}

/** Three-wheeler (Auto): one wheel in front, a canopy over the back. */
function rickshaw(id: string) {
  return silhouette(
    id,
    `<rect x="14" y="3" width="4" height="11" rx="2"/>
     <path d="M16 11 Q8 15 8 25 L6 29 L6 56 Q6 60 10 60 L22 60 Q26 60 26 56 L26 29 L24 25 Q24 15 16 11 Z"/>
     <rect x="2.5" y="43" width="4" height="12" rx="2"/><rect x="25.5" y="43" width="4" height="12" rx="2"/>`,
    `<path d="M10.5 23 Q16 19 21.5 23 L22 29.5 L10 29.5 Z" fill="${GLASS}"/>
     <rect x="9.5" y="33" width="13" height="23" rx="3" fill="${GLASS}" opacity=".55"/>`,
  );
}

let seq = 0;
function vehicleSvg(type: string | null | undefined) {
  const id = `v${++seq}`;
  switch (type) {
    case 'bike':
      return scooter(id);
    case 'auto':
      return rickshaw(id);
    case 'comfort':
      return sedan(id);
    case 'xl':
      return suv(id);
    default:
      return hatchback(id);
  }
}

function bearing(a: L.LatLng, b: L.LatLng): number | null {
  if (a.equals(b)) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * A vehicle that glides between position updates instead of jumping, and
 * turns through the shortest angle. Each update is animated over roughly the
 * time since the previous one, so it reaches the new fix as the next lands.
 */
export default function CarMarker({ lat, lng, heading, active, vehicleType }: Props) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  const raf = useRef<number | null>(null);
  const lastUpdate = useRef(0);
  const curHeading = useRef<number>(heading ?? 0);

  useEffect(() => {
    const icon = L.divIcon({
      className: 'car-wrap',
      html: `<div class="car-marker ${active ? 'car-active' : ''}"><div class="car-body" style="transform:rotate(${curHeading.current}deg)">${vehicleSvg(vehicleType)}</div></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const m = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 500, keyboard: false }).addTo(map);
    marker.current = m;
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      m.remove();
      marker.current = null;
    };
    // Created once per map / class / active state; position and heading are animated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active, vehicleType]);

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

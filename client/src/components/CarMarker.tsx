import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

interface Props {
  lat: number;
  lng: number;
  heading?: number | null;
  active?: boolean;
  /** bike | auto | economy | comfort | xl — picks the drawing and its colour. */
  vehicleType?: string | null;
}

/**
 * Top-down vehicle illustrations in the style ride-hailing apps use: a shaded
 * body with a lighter roof, dark glass with a highlight, mirrors, head and tail
 * lights and a soft drop shadow. Each class has its own shape and colour so a
 * rider can tell a scooter from an SUV at a glance. All point north (up); the
 * wrapper is rotated to the heading. Drawn on a 64×128 canvas.
 */
const PALETTE: Record<string, { body: string; dark: string; light: string }> = {
  economy: { body: '#f4f5f7', dark: '#c3c7cf', light: '#ffffff' }, // white hatchback / sedan
  comfort: { body: '#4c6ef5', dark: '#2f4ac4', light: '#8aa2ff' }, // blue sedan
  xl: { body: '#343a40', dark: '#1d2126', light: '#5c636a' }, // charcoal SUV
  bike: { body: '#e03131', dark: '#a61e1e', light: '#ff7b7b' }, // red scooter
  auto: { body: '#f7c948', dark: '#cf9a0a', light: '#ffe59a' }, // yellow three-wheeler
};

const defs = (id: string, p: { body: string; dark: string; light: string }) => `
  <defs>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.dark}"/><stop offset="0.25" stop-color="${p.body}"/>
      <stop offset="0.75" stop-color="${p.body}"/><stop offset="1" stop-color="${p.dark}"/>
    </linearGradient>
    <linearGradient id="${id}-roof" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.body}"/><stop offset="0.5" stop-color="${p.light}"/><stop offset="1" stop-color="${p.body}"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5f6b7a"/><stop offset="1" stop-color="#1f2630"/>
    </linearGradient>
    <radialGradient id="${id}-shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.6" stop-color="rgba(0,0,0,0.35)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
  </defs>`;

const wheel = (x: number, y: number, w = 7, h = 16) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="#15181c"/>`;
const glassShine = (x: number, y: number, w: number) => `<rect x="${x}" y="${y}" width="${w}" height="2.5" rx="1.2" fill="rgba(255,255,255,0.55)"/>`;

function sedan(id: string, p: { body: string; dark: string; light: string }, suv = false) {
  const w = suv ? 46 : 40; // body width
  const x = (64 - w) / 2;
  const top = suv ? 10 : 14;
  const h = 128 - top - 12;
  return `<svg viewBox="0 0 64 128" width="30" height="60" aria-hidden="true">${defs(id, p)}
    <ellipse cx="32" cy="66" rx="${w / 2 + 8}" ry="56" fill="url(#${id}-shadow)"/>
    ${wheel(x - 4, top + 22)}${wheel(x + w - 3, top + 22)}${wheel(x - 4, top + h - 40)}${wheel(x + w - 3, top + h - 40)}
    <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="${suv ? 12 : 16}" fill="url(#${id}-body)" stroke="${p.dark}" stroke-width="1"/>
    <rect x="${x + 5}" y="${top + 30}" width="${w - 10}" height="${h - 62}" rx="${suv ? 7 : 10}" fill="url(#${id}-roof)"/>
    ${suv ? `<rect x="${x + 7}" y="${top + 34}" width="2" height="${h - 70}" rx="1" fill="${p.dark}" opacity=".6"/><rect x="${x + w - 9}" y="${top + 34}" width="2" height="${h - 70}" rx="1" fill="${p.dark}" opacity=".6"/>` : ''}
    <path d="M${x + 6} ${top + 30} Q32 ${top + 14} ${x + w - 6} ${top + 30} L${x + w - 8} ${top + 40} L${x + 8} ${top + 40} Z" fill="url(#${id}-glass)"/>
    ${glassShine(x + 11, top + 24, w - 22)}
    <path d="M${x + 8} ${top + h - 34} L${x + w - 8} ${top + h - 34} Q32 ${top + h - 18} ${x + 8} ${top + h - 34} Z" fill="url(#${id}-glass)"/>
    <rect x="${x - 5}" y="${top + 36}" width="6" height="4" rx="1.5" fill="${p.dark}"/><rect x="${x + w - 1}" y="${top + 36}" width="6" height="4" rx="1.5" fill="${p.dark}"/>
    <rect x="${x + 5}" y="${top + 1}" width="10" height="4" rx="2" fill="#fff3bf"/><rect x="${x + w - 15}" y="${top + 1}" width="10" height="4" rx="2" fill="#fff3bf"/>
    <rect x="${x + 5}" y="${top + h - 5}" width="10" height="4" rx="2" fill="#ff6b6b"/><rect x="${x + w - 15}" y="${top + h - 5}" width="10" height="4" rx="2" fill="#ff6b6b"/>
  </svg>`;
}

function scooter(id: string, p: { body: string; dark: string; light: string }) {
  return `<svg viewBox="0 0 64 128" width="30" height="60" aria-hidden="true">${defs(id, p)}
    <ellipse cx="32" cy="66" rx="22" ry="54" fill="url(#${id}-shadow)"/>
    <rect x="28" y="14" width="8" height="22" rx="4" fill="#15181c"/>
    <rect x="28" y="92" width="8" height="24" rx="4" fill="#15181c"/>
    <rect x="12" y="28" width="40" height="5" rx="2.5" fill="#2b2f36"/>
    <rect x="22" y="34" width="20" height="60" rx="10" fill="url(#${id}-body)" stroke="${p.dark}" stroke-width="1"/>
    <rect x="25" y="38" width="14" height="16" rx="7" fill="url(#${id}-roof)"/>
    <rect x="24" y="60" width="16" height="30" rx="7" fill="#1f2630"/>
    <circle cx="32" cy="72" r="9" fill="${p.light}" stroke="${p.dark}" stroke-width="1"/>
    <rect x="27" y="20" width="10" height="4" rx="2" fill="#fff3bf"/>
    <rect x="27" y="104" width="10" height="4" rx="2" fill="#ff6b6b"/>
  </svg>`;
}

function rickshaw(id: string, p: { body: string; dark: string; light: string }) {
  return `<svg viewBox="0 0 64 128" width="30" height="60" aria-hidden="true">${defs(id, p)}
    <ellipse cx="32" cy="66" rx="26" ry="54" fill="url(#${id}-shadow)"/>
    <rect x="28" y="12" width="8" height="18" rx="4" fill="#15181c"/>
    ${wheel(10, 76, 7, 18)}${wheel(47, 76, 7, 18)}
    <path d="M32 22 Q12 30 14 52 L14 104 Q14 112 22 112 L42 112 Q50 112 50 104 L50 52 Q52 30 32 22 Z" fill="url(#${id}-body)" stroke="${p.dark}" stroke-width="1"/>
    <path d="M18 56 L46 56 L46 104 Q46 108 42 108 L22 108 Q18 108 18 104 Z" fill="#2f9e44"/>
    <rect x="20" y="60" width="24" height="44" rx="4" fill="url(#${id}-roof)" opacity=".92"/>
    <path d="M18 40 Q32 30 46 40 L45 52 L19 52 Z" fill="url(#${id}-glass)"/>
    ${glassShine(23, 36, 18)}
    <rect x="27" y="14" width="10" height="4" rx="2" fill="#fff3bf"/>
    <rect x="22" y="108" width="8" height="4" rx="2" fill="#ff6b6b"/><rect x="34" y="108" width="8" height="4" rx="2" fill="#ff6b6b"/>
  </svg>`;
}

let seq = 0;
function vehicleSvg(type: string | null | undefined, active?: boolean) {
  const key = type && PALETTE[type] ? type : 'economy';
  const p = PALETTE[key];
  const id = `v${key}${active ? 'a' : ''}${++seq}`;
  if (key === 'bike') return scooter(id, p);
  if (key === 'auto') return rickshaw(id, p);
  return sedan(id, p, key === 'xl');
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
      html: `<div class="car-marker ${active ? 'car-active' : ''}"><div class="car-body" style="transform:rotate(${curHeading.current}deg)">${vehicleSvg(vehicleType, active)}</div></div>`,
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

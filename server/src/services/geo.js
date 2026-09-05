/**
 * Geo services: geocoding (Nominatim) and routing (OSRM).
 * Both are proxied through the backend so the browser never talks to third
 * parties directly, so we can attach a proper User-Agent, cache responses,
 * and (most importantly) re-derive distance/fare server-side.
 */
import { config } from '../config.js';

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function cachedJson(url, init) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`), { status: 502 });
  }
  const value = await res.json();
  cache.set(url, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function geocode(query, { limit = 6, near } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
  });
  if (near) {
    // Bias results to a box around the user (~50km).
    const d = 0.45;
    params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  const data = await cachedJson(`${config.nominatimUrl}/search?${params}`);
  return data.map((r) => ({
    label: r.display_name,
    name: r.name || r.display_name.split(',')[0],
    lat: Number(r.lat),
    lng: Number(r.lon),
    type: r.type,
  }));
}

export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '18' });
  const data = await cachedJson(`${config.nominatimUrl}/reverse?${params}`);
  return {
    label: data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    name: data.name || data.display_name?.split(',')[0] || 'Pinned location',
    lat,
    lng,
  };
}

/**
 * Fetch route options for an ordered list of waypoints.
 * With exactly two points OSRM returns up to 3 alternatives; with via points it
 * returns a single route threading them in order (that IS the customer's chosen route).
 *
 * @param {{lat:number,lng:number}[]} points
 * @returns {Promise<Array<{index:number, distance_km:number, duration_min:number, geometry:[number,number][], legs:object[]}>>}
 */
export async function fetchRoutes(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw Object.assign(new Error('At least two waypoints are required'), { status: 400 });
  }
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const params = new URLSearchParams({
    alternatives: points.length === 2 ? '3' : 'false',
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
    annotations: 'false',
  });
  const data = await cachedJson(`${config.osrmUrl}/route/v1/driving/${coords}?${params}`);
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw Object.assign(new Error(data.message || 'No route found'), { status: 422 });
  }
  return data.routes.map((r, index) => ({
    index,
    distance_km: r.distance / 1000,
    duration_min: r.duration / 60,
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    legs: r.legs.map((l) => ({ distance_km: l.distance / 1000, duration_min: l.duration / 60 })),
  }));
}

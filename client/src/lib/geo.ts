export const DEFAULT_CENTER: [number, number] = [28.6139, 77.209]; // New Delhi (seed drivers live here)

export function getCurrentPosition(timeout = 6000): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    // The browser permission prompt can sit unanswered forever, so enforce our own deadline too.
    const deadline = window.setTimeout(() => resolve(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(deadline);
        resolve([p.coords.latitude, p.coords.longitude]);
      },
      () => {
        window.clearTimeout(deadline);
        resolve(null);
      },
      { timeout, maximumAge: 60000 },
    );
  });
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Move `fraction` of the way from a to b (linear, fine for short hops). */
export function lerp(a: { lat: number; lng: number }, b: { lat: number; lng: number }, fraction: number) {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction };
}

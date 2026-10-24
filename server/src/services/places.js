/**
 * Place suggestions that appear before and while the user types:
 *   recent  – places this user has used (pickups / drop-offs), most used first
 *   popular – places everyone uses, most used first
 *   common  – well-known landmarks (seeded for the Chandigarh tricity: Chandigarh,
 *             Mohali, Zirakpur and Panchkula; extend per city)
 * Filtering is done here so one character is enough to narrow the list.
 */
import { db } from '../db.js';

export const COMMON_PLACES = [
  // Chandigarh
  { name: 'Sector 17 Plaza', label: 'Sector 17, Chandigarh', lat: 30.741, lng: 76.7822 },
  { name: 'Elante Mall', label: 'Industrial Area Phase 1, Chandigarh', lat: 30.7056, lng: 76.8013 },
  { name: 'Sukhna Lake', label: 'Main gate, Sector 1, Chandigarh', lat: 30.7409, lng: 76.8120 }, // the entrance on Uttar Marg, not the water
  { name: 'Rock Garden', label: 'Sector 1, Chandigarh', lat: 30.7525, lng: 76.8101 },
  { name: 'Rose Garden', label: 'Zakir Hussain Rose Garden, Sector 16, Chandigarh', lat: 30.7473, lng: 76.7868 },
  { name: 'PGIMER', label: 'Post Graduate Institute, Sector 12, Chandigarh', lat: 30.7649, lng: 76.7748 },
  { name: 'Panjab University', label: 'Sector 14, Chandigarh', lat: 30.7601, lng: 76.7684 },
  { name: 'Chandigarh Railway Station', label: 'Daria, Chandigarh', lat: 30.7042, lng: 76.8426 },
  { name: 'Chandigarh Airport', label: 'Shaheed Bhagat Singh International Airport', lat: 30.6735, lng: 76.7885 },
  { name: 'ISBT Sector 43', label: 'Inter State Bus Terminal, Sector 43, Chandigarh', lat: 30.7174, lng: 76.7484 },
  { name: 'ISBT Sector 17', label: 'Bus stand, Sector 17, Chandigarh', lat: 30.7395, lng: 76.7867 },
  { name: 'Sector 35 Market', label: 'Sector 35, Chandigarh', lat: 30.7267, lng: 76.7676 },
  { name: 'Chandigarh IT Park', label: 'Rajiv Gandhi Technology Park, Kishangarh', lat: 30.7378, lng: 76.8338 },
  { name: 'Capitol Complex', label: 'Sector 1, Chandigarh', lat: 30.7595, lng: 76.8065 },
  // Mohali (SAS Nagar)
  { name: 'Phase 3B2 Market', label: 'Phase 3B2, Mohali', lat: 30.7119, lng: 76.7196 },
  { name: 'PCA Cricket Stadium', label: 'Sector 63, Mohali', lat: 30.6907, lng: 76.7375 },
  { name: 'Fortis Hospital Mohali', label: 'Sector 62, Mohali', lat: 30.6918, lng: 76.7409 },
  { name: 'Mohali Bus Stand', label: 'Phase 6, Mohali', lat: 30.7032, lng: 76.7231 },
  { name: 'IISER Mohali', label: 'Sector 81, Knowledge City, Mohali', lat: 30.6652, lng: 76.7294 },
  { name: 'Aerocity Mohali', label: 'Airport Road, Mohali', lat: 30.6676, lng: 76.7563 },
  { name: 'VR Punjab Mall', label: 'Kharar–Chandigarh road, Mohali', lat: 30.7126, lng: 76.6916 },
  { name: 'Sector 70 Market', label: 'Sector 70, Mohali', lat: 30.694, lng: 76.714 },
  // Zirakpur
  { name: 'Zirakpur Chowk', label: 'Zirakpur flyover, Chandigarh–Ambala highway', lat: 30.6425, lng: 76.8173 },
  { name: 'Cosmo Mall Zirakpur', label: 'Zirakpur', lat: 30.6448, lng: 76.8233 },
  { name: 'Paras Downtown Square', label: 'Zirakpur', lat: 30.6428, lng: 76.8212 },
  { name: 'Dhakoli', label: 'Dhakoli, Zirakpur', lat: 30.6515, lng: 76.8395 },
  // Panchkula
  { name: 'Sector 5 Panchkula', label: 'Sector 5 market, Panchkula', lat: 30.6942, lng: 76.8606 },
  { name: 'Panchkula Bus Stand', label: 'Sector 5, Panchkula', lat: 30.6931, lng: 76.8583 },
  { name: 'Mansa Devi Temple', label: 'Mata Mansa Devi, Panchkula', lat: 30.7161, lng: 76.864 },
  { name: 'Sector 20 Panchkula', label: 'Sector 20, Panchkula', lat: 30.672, lng: 76.871 },
  { name: 'Cactus Garden', label: 'Sector 5, Panchkula', lat: 30.7031, lng: 76.8481 },
  { name: 'Chandimandir', label: 'Chandimandir, Panchkula', lat: 30.7232, lng: 76.8829 },
  { name: 'Pinjore Gardens', label: 'Yadavindra Gardens, Pinjore', lat: 30.7963, lng: 76.9145 },
];

const stmts = {
  mine: db.prepare(`
    SELECT address, lat, lng, COUNT(*) AS uses, MAX(created_at) AS last_used FROM (
      SELECT pickup_address AS address, pickup_lat AS lat, pickup_lng AS lng, created_at FROM rides WHERE (customer_id = ? OR driver_id = ?)
      UNION ALL
      SELECT dropoff_address, dropoff_lat, dropoff_lng, created_at FROM rides WHERE (customer_id = ? OR driver_id = ?)
    ) WHERE address IS NOT NULL AND address <> ''
    GROUP BY address ORDER BY uses DESC, last_used DESC LIMIT 8`),
  popular: db.prepare(`
    SELECT address, lat, lng, COUNT(*) AS uses FROM (
      SELECT pickup_address AS address, pickup_lat AS lat, pickup_lng AS lng FROM rides
      UNION ALL
      SELECT dropoff_address, dropoff_lat, dropoff_lng FROM rides
    ) WHERE address IS NOT NULL AND address <> ''
    GROUP BY address ORDER BY uses DESC LIMIT 8`),
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word of the query must appear somewhere in the name or label. */
function matches(place, q) {
  if (!q) return true;
  const hay = `${norm(place.name)} ${norm(place.label)}`;
  return norm(q)
    .split(' ')
    .every((w) => hay.includes(w));
}

/** Prefer matches at the start of the name, then earlier positions. */
function rank(place, q) {
  if (!q) return 0;
  const n = norm(place.name);
  const first = norm(q).split(' ')[0];
  if (n.startsWith(first)) return 0;
  const words = n.split(' ');
  if (words.some((w) => w.startsWith(first))) return 1;
  return 2;
}

const short = (address) => String(address).split(',')[0].trim();

export function suggestPlaces(user, q = '', { limit = 8 } = {}) {
  const seen = new Set();
  const out = [];
  const push = (p, source) => {
    // Same spot (within ~100 m) or same name counts as a duplicate.
    const keys = [`${Math.round(p.lat * 1000)},${Math.round(p.lng * 1000)}`, `n:${norm(p.name)}`];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ ...p, source });
  };

  for (const r of stmts.mine.all(user.id, user.id, user.id, user.id)) {
    push({ name: short(r.address), label: r.address, lat: r.lat, lng: r.lng, uses: r.uses }, 'recent');
  }
  for (const r of stmts.popular.all()) {
    push({ name: short(r.address), label: r.address, lat: r.lat, lng: r.lng, uses: r.uses }, 'popular');
  }
  for (const c of COMMON_PLACES) push(c, 'common');

  const order = { recent: 0, popular: 1, common: 2 };
  return out
    .filter((p) => matches(p, q))
    .map((p) => ({ ...p, _r: rank(p, q) }))
    .sort((a, b) => a._r - b._r || order[a.source] - order[b.source] || (b.uses || 0) - (a.uses || 0))
    .slice(0, limit)
    .map(({ _r, uses, ...p }) => p);
}

/**
 * Place suggestions that appear before and while the user types:
 *   recent  – places this user has used (pickups / drop-offs), most used first
 *   popular – places everyone uses, most used first
 *   common  – well-known landmarks (seeded for Delhi NCR; extend per city)
 * Filtering is done here so one character is enough to narrow the list.
 */
import { db } from '../db.js';

export const COMMON_PLACES = [
  { name: 'Indira Gandhi International Airport (T3)', label: 'IGI Airport Terminal 3, New Delhi', lat: 28.5562, lng: 77.1 },
  { name: 'IGI Airport Terminal 1', label: 'Domestic Terminal 1, New Delhi', lat: 28.5665, lng: 77.1124 },
  { name: 'New Delhi Railway Station', label: 'Paharganj side, New Delhi', lat: 28.6431, lng: 77.2197 },
  { name: 'Connaught Place', label: 'Rajiv Chowk, New Delhi', lat: 28.6315, lng: 77.2167 },
  { name: 'India Gate', label: 'Kartavya Path, New Delhi', lat: 28.6129, lng: 77.2295 },
  { name: 'Hauz Khas Village', label: 'South Delhi', lat: 28.5535, lng: 77.1935 },
  { name: 'Select Citywalk, Saket', label: 'Saket District Centre, New Delhi', lat: 28.5286, lng: 77.2191 },
  { name: 'AIIMS', label: 'All India Institute of Medical Sciences, Ansari Nagar', lat: 28.5672, lng: 77.21 },
  { name: 'Karol Bagh', label: 'Ajmal Khan Road, New Delhi', lat: 28.6519, lng: 77.1909 },
  { name: 'Lajpat Nagar Central Market', label: 'Lajpat Nagar, New Delhi', lat: 28.5677, lng: 77.2433 },
  { name: 'Chandni Chowk', label: 'Old Delhi', lat: 28.6506, lng: 77.2303 },
  { name: 'Red Fort', label: 'Netaji Subhash Marg, Old Delhi', lat: 28.6562, lng: 77.241 },
  { name: 'Qutub Minar', label: 'Mehrauli, New Delhi', lat: 28.5245, lng: 77.1855 },
  { name: 'Lotus Temple', label: 'Kalkaji, New Delhi', lat: 28.5535, lng: 77.2588 },
  { name: 'Anand Vihar ISBT', label: 'Bus terminal, East Delhi', lat: 28.6469, lng: 77.3158 },
  { name: 'Kashmere Gate ISBT', label: 'Bus terminal, North Delhi', lat: 28.6677, lng: 77.2285 },
  { name: 'Nizamuddin Railway Station', label: 'Hazrat Nizamuddin, New Delhi', lat: 28.5891, lng: 77.2537 },
  { name: 'Cyber Hub, Gurugram', label: 'DLF Cyber City, Gurugram', lat: 28.4949, lng: 77.0895 },
  { name: 'Ambience Mall, Gurugram', label: 'NH-48, Gurugram', lat: 28.5044, lng: 77.0966 },
  { name: 'Sector 18, Noida', label: 'Atta Market, Noida', lat: 28.5708, lng: 77.3261 },
  { name: 'DLF Mall of India, Noida', label: 'Sector 18, Noida', lat: 28.5675, lng: 77.3211 },
  { name: 'Dwarka Sector 21 Metro', label: 'Dwarka, New Delhi', lat: 28.5522, lng: 77.0583 },
  { name: 'Rohini Sector 7', label: 'Rohini, New Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Janakpuri District Centre', label: 'Janakpuri, New Delhi', lat: 28.6289, lng: 77.0781 },
  { name: 'Vasant Kunj', label: 'DLF Promenade, Vasant Kunj', lat: 28.5245, lng: 77.1554 },
  { name: 'Pacific Mall, Tagore Garden', label: 'Najafgarh Road, West Delhi', lat: 28.6421, lng: 77.1136 },
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

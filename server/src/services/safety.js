/**
 * Safety features:
 *   - a 4-digit PIN the rider reads out so the driver knows they have the right person
 *   - a public "follow my trip" link that needs no account
 *   - an SOS button that alerts admins and lists the rider's emergency contacts
 */
import { db, randomToken } from '../db.js';

let notify = () => {};
export function setSafetyNotifier(fn) {
  notify = fn;
}

const stmts = {
  ride: db.prepare('SELECT * FROM rides WHERE id = ?'),
  byToken: db.prepare('SELECT * FROM rides WHERE share_token = ?'),
  driver: db.prepare(`SELECT u.name, u.phone, p.vehicle_make, p.vehicle_model, p.vehicle_color, p.plate, p.lat, p.lng, p.heading, p.rating
                      FROM users u LEFT JOIN driver_profiles p ON p.user_id = u.id WHERE u.id = ?`),
  customer: db.prepare('SELECT name FROM users WHERE id = ?'),
  contacts: db.prepare('SELECT * FROM emergency_contacts WHERE user_id = ? ORDER BY id'),
  addContact: db.prepare('INSERT INTO emergency_contacts (user_id, name, phone) VALUES (?,?,?)'),
  delContact: db.prepare('DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?'),
  addSos: db.prepare('INSERT INTO sos_alerts (ride_id, user_id, role, lat, lng, note) VALUES (?,?,?,?,?,?)'),
  sos: db.prepare('SELECT * FROM sos_alerts WHERE id = ?'),
  openSos: db.prepare(`SELECT s.*, u.name AS user_name, u.phone AS user_phone
                       FROM sos_alerts s JOIN users u ON u.id = s.user_id
                       WHERE s.status != 'resolved' ORDER BY s.id DESC`),
  allSos: db.prepare(`SELECT s.*, u.name AS user_name, u.phone AS user_phone
                      FROM sos_alerts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100`),
  resolveSos: db.prepare(`UPDATE sos_alerts SET status = ?, handled_by = ?, resolved_at = datetime('now') WHERE id = ?`),
  admins: db.prepare('SELECT id FROM users WHERE is_admin = 1'),
};

export function makePin() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export function makeShareToken() {
  return randomToken(12);
}

/** Everything a stranger holding the link may see. No names of the rider, no phone numbers. */
export function publicTrip(token) {
  const r = stmts.byToken.get(String(token || ''));
  if (!r) throw Object.assign(new Error('That trip link is not valid'), { status: 404 });
  const d = r.driver_id ? stmts.driver.get(r.driver_id) : null;
  return {
    id: r.id,
    status: r.status,
    rider: stmts.customer.get(r.customer_id)?.name?.split(' ')[0] || 'Rider',
    pickup_address: r.pickup_address,
    dropoff_address: r.dropoff_address,
    waypoints: JSON.parse(r.waypoints),
    route_geometry: JSON.parse(r.route_geometry),
    distance_km: r.distance_km,
    duration_min: r.duration_min,
    created_at: r.created_at,
    completed_at: r.completed_at,
    driver: d
      ? {
          name: d.name,
          vehicle: [d.vehicle_color, d.vehicle_make, d.vehicle_model].filter(Boolean).join(' '),
          plate: d.plate,
          rating: d.rating,
          lat: d.lat,
          lng: d.lng,
          heading: d.heading,
        }
      : null,
  };
}

export function listContacts(userId) {
  return stmts.contacts.all(userId);
}

export function addContact(userId, name, phone) {
  if (!name?.trim() || !phone?.trim()) throw Object.assign(new Error('Name and phone are required'), { status: 400 });
  if (stmts.contacts.all(userId).length >= 5) throw Object.assign(new Error('You can save up to 5 contacts'), { status: 400 });
  stmts.addContact.run(userId, name.trim(), phone.trim());
  return stmts.contacts.all(userId);
}

export function removeContact(userId, id) {
  stmts.delContact.run(id, userId);
  return stmts.contacts.all(userId);
}

/**
 * Raise an emergency. Alerts every admin in real time and returns the share link
 * plus the user's contacts so the app can offer one-tap call / SMS.
 */
export function raiseSos(user, { ride_id, lat, lng, note } = {}) {
  const ride = ride_id ? stmts.ride.get(Number(ride_id)) : null;
  if (ride && ride.customer_id !== user.id && ride.driver_id !== user.id) {
    throw Object.assign(new Error('Not your ride'), { status: 403 });
  }
  const r = stmts.addSos.run(ride?.id ?? null, user.id, user.role, lat ?? null, lng ?? null, note ?? null);
  const alert = stmts.sos.get(Number(r.lastInsertRowid));

  for (const a of stmts.admins.all()) notify('admin', a.id, { ...alert, user_name: user.name, user_phone: user.phone });

  return {
    alert,
    share_url: ride ? `/t/${ride.share_token}` : null,
    contacts: listContacts(user.id),
  };
}

export function listSos({ all = false } = {}) {
  return (all ? stmts.allSos : stmts.openSos).all();
}

export function resolveSos(admin, id, status = 'resolved') {
  if (!['acknowledged', 'resolved'].includes(status)) throw Object.assign(new Error('Bad status'), { status: 400 });
  stmts.resolveSos.run(status, admin.id, id);
  return stmts.sos.get(id);
}

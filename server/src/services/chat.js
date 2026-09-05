/** In-ride chat between the customer and the assigned driver. */
import { db } from '../db.js';

let notify = () => {};
export function setChatNotifier(fn) {
  notify = fn;
}

const CHAT_STATES = ['accepted', 'arrived', 'in_progress'];

const stmts = {
  ride: db.prepare('SELECT id, customer_id, driver_id, status FROM rides WHERE id = ?'),
  list: db.prepare(
    `SELECT m.id, m.ride_id, m.sender_id, u.name AS sender_name, m.body, m.created_at
     FROM ride_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.ride_id = ? ORDER BY m.id LIMIT 200`,
  ),
  insert: db.prepare('INSERT INTO ride_messages (ride_id, sender_id, body) VALUES (?,?,?)'),
  one: db.prepare(
    `SELECT m.id, m.ride_id, m.sender_id, u.name AS sender_name, m.body, m.created_at
     FROM ride_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
  ),
};

function partyRide(user, rideId) {
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  if (ride.customer_id !== user.id && ride.driver_id !== user.id) {
    throw Object.assign(new Error('Not your ride'), { status: 403 });
  }
  return ride;
}

export function listMessages(user, rideId) {
  partyRide(user, rideId);
  return stmts.list.all(rideId);
}

export function sendMessage(user, rideId, body) {
  const text = String(body ?? '').trim();
  if (!text) throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
  if (text.length > 1000) throw Object.assign(new Error('Message too long'), { status: 400 });
  const ride = partyRide(user, rideId);
  if (!CHAT_STATES.includes(ride.status)) {
    throw Object.assign(new Error('Chat is available once a driver has accepted and until the trip ends'), { status: 409 });
  }
  const r = stmts.insert.run(rideId, user.id, text);
  const msg = stmts.one.get(Number(r.lastInsertRowid));
  notify(ride, msg);
  return msg;
}

/** Used by the realtime layer to validate call signalling between the two parties. */
export function counterpartFor(user, rideId) {
  const ride = partyRide(user, rideId);
  if (!CHAT_STATES.includes(ride.status)) return null;
  return ride.customer_id === user.id ? ride.driver_id : ride.customer_id;
}

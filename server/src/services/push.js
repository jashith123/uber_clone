/**
 * Web push notifications.
 *
 * Free and account-less: VAPID keys are generated locally (npm run push:keys)
 * and put in the server .env. The browser or installed PWA then receives
 * notifications even when the app is closed. Android's installed app and every
 * desktop browser support this; on iPhone the app must be added to the Home
 * Screen first (iOS 16.4+).
 *
 * If no keys are configured everything degrades quietly: subscriptions are
 * refused with a clear message and sends are skipped, so nothing breaks.
 */
import webpush from 'web-push';
import { db } from '../db.js';
import { config } from '../config.js';

let ready = false;
if (config.push.publicKey && config.push.privateKey) {
  try {
    webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    ready = true;
  } catch (e) {
    console.warn('Push disabled:', e.message);
  }
}

export const pushEnabled = () => ready;
export const publicKey = () => config.push.publicKey || null;

const stmts = {
  save: db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
                    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`),
  forUser: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
  drop: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
  ok: db.prepare(`UPDATE push_subscriptions SET last_ok_at = datetime('now') WHERE id = ?`),
  count: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?'),
};

export function subscribe(userId, sub) {
  if (!ready) throw Object.assign(new Error('Push is not configured on this server'), { status: 503 });
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw Object.assign(new Error('Invalid push subscription'), { status: 400 });
  }
  stmts.save.run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  return { subscriptions: stmts.count.get(userId).n };
}

export function unsubscribe(endpoint) {
  if (endpoint) stmts.drop.run(endpoint);
  return { ok: true };
}

/**
 * Send to every device a user has registered. Never throws: a failed push must
 * not fail the ride action that triggered it.
 * @param {number} userId
 * @param {{title:string, body:string, url?:string, tag?:string, data?:object}} payload
 */
export async function sendToUser(userId, payload) {
  if (!ready) return { sent: 0, skipped: true };
  const subs = stmts.forUser.all(userId);
  if (!subs.length) return { sent: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'swiftride',
    data: payload.data || {},
  });

  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 120 });
        stmts.ok.run(s.id);
        sent += 1;
      } catch (e) {
        // 404/410 mean the browser dropped the subscription: forget it.
        if (e.statusCode === 404 || e.statusCode === 410) stmts.drop.run(s.endpoint);
      }
    }),
  );
  return { sent };
}

/** Fire-and-forget helper for use inside request handlers. */
export function notifyUser(userId, payload) {
  sendToUser(userId, payload).catch(() => {});
}

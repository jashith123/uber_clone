/**
 * Web push subscription helper.
 *
 * Everything degrades quietly: if the browser has no push support, the server
 * has no keys, or the user says no, the app carries on without notifications.
 */
import { api } from './api';

const ASKED_KEY = 'swiftride.pushAsked';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/** Has the user already been asked once in this browser? */
export function alreadyAsked() {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Ask for permission (if not already granted) and register with the server.
 * @returns true when notifications are live for this device.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const cfg = await api<{ enabled: boolean; public_key: string | null }>('/push/config');
    if (!cfg.enabled || !cfg.public_key) return false;

    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* ignore */
    }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.public_key),
      }));

    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    return true;
  } catch {
    return false;
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}

export async function sendTestPush() {
  return api<{ sent: number }>('/push/test', { method: 'POST' });
}

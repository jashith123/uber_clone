const TOKEN_KEY = 'swiftride.token';
const BASE_KEY = 'swiftride.apiBase';

/** True when running inside the Capacitor native shell (APK / IPA). */
export function isNativeApp(): boolean {
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

/**
 * Where the API lives.
 *
 *  - Website: always its own origin (''). The site is served by the API, so a
 *    saved address must never override it. Without this rule a stale value left
 *    behind by native-app testing in the same browser silently breaks the site.
 *  - Native app (APK): the address typed on the login screen, else the one baked
 *    in at build time with VITE_API_URL.
 */
export function apiBase(): string {
  if (!isNativeApp()) return '';
  try {
    const saved = localStorage.getItem(BASE_KEY);
    if (saved) return saved.replace(/\/+$/, '');
  } catch {
    /* storage unavailable */
  }
  return (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
}

export function setApiBase(url: string | null) {
  try {
    if (url && url.trim()) localStorage.setItem(BASE_KEY, url.trim().replace(/\/+$/, ''));
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api${path}`, {
      method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, `Cannot reach the server at ${apiBase() || window.location.origin}. Check the server address and that the PC is running "npm run serve".`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || res.statusText);
  return data as T;
}

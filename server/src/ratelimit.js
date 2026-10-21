/**
 * Tiny in-memory rate limiter, enough to blunt password guessing and signup
 * floods on a single-process deployment. `max` hits per `windowMs` per key
 * (the client IP by default; `trust proxy` is set, so this is the real IP
 * behind Render, Fly or a tunnel).
 *
 * With `skipSuccessful`, requests that end in a 2xx/3xx do not count, so a
 * room full of testers behind one Wi-Fi router can all log in, while thirty
 * wrong passwords in a row still lock the address out.
 */
export function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 30,
  message = 'Too many attempts. Please wait a while and try again.',
  key = (req) => req.ip,
  skipSuccessful = false,
} = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const k = key(req) || 'unknown';
    const now = Date.now();
    let v = hits.get(k);
    if (!v || v.reset <= now) {
      v = { count: 0, reset: now + windowMs };
      hits.set(k, v);
    }
    v.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - v.count)));
    if (v.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((v.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    if (skipSuccessful) {
      res.on('finish', () => {
        if (res.statusCode < 400) v.count = Math.max(0, v.count - 1);
      });
    }
    next();
  };
}

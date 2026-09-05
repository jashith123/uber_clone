const symbols: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

export function money(amount: number | null | undefined, currency = 'INR') {
  if (amount == null) return '—';
  const sym = symbols[currency] ?? `${currency} `;
  return `${sym}${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

export function km(n: number | null | undefined) {
  if (n == null) return '—';
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} km`;
}

export function mins(n: number | null | undefined) {
  if (n == null) return '—';
  const m = Math.round(n);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function shortAddress(s: string | null | undefined, fallback = 'Pinned location') {
  if (!s) return fallback;
  return s.split(',').slice(0, 2).join(',');
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Finding a driver',
  accepted: 'Driver on the way',
  arrived: 'Driver has arrived',
  in_progress: 'On trip',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** "+₹393.24" for money in, "−₹30" for money out, "₹0" for nothing. */
export function signed(amount: number, currency = 'INR') {
  if (!amount) return money(0, currency);
  return `${amount > 0 ? '+' : '−'}${money(Math.abs(amount), currency)}`;
}

export function signedClass(amount: number) {
  return amount > 0 ? 'amt amt-pos' : amount < 0 ? 'amt amt-neg' : 'amt amt-zero';
}

/** What a ride did to someone's money, from their point of view. */
export function rideLedger(r: { status: string; fare_final: number | null; fare_estimate: number; cancel_fee: number; driver_penalty: number; cancelled_by: string | null }, side: 'customer' | 'driver') {
  if (r.status === 'completed') {
    const fare = r.fare_final ?? r.fare_estimate;
    return side === 'driver' ? { amount: fare, note: 'trip fare' } : { amount: -fare, note: 'trip fare' };
  }
  if (r.status === 'cancelled') {
    if (side === 'driver') {
      if (r.driver_penalty) return { amount: -r.driver_penalty, note: 'penalty: you cancelled after accepting' };
      if (r.cancel_fee) return { amount: r.cancel_fee, note: 'late-cancellation fee from rider' };
      return { amount: 0, note: r.cancelled_by === 'driver' ? 'cancelled by you' : 'cancelled by rider, no charge' };
    }
    if (r.cancel_fee) return { amount: -r.cancel_fee, note: 'late-cancellation fee' };
    return { amount: 0, note: r.cancelled_by === 'customer' ? 'cancelled, no charge' : 'cancelled by driver, no charge' };
  }
  return { amount: 0, note: 'in progress' };
}

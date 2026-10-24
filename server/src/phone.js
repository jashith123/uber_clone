/**
 * Phone numbers are stored one way: +<country><number>, digits only, so the
 * same person typed as "+91 98765 43210", "098765 43210" or "9876543210" is
 * always the same account. Ten digits with no country code are taken as India.
 * Returns null for anything that is not a usable number.
 */
export function normalizePhone(raw) {
  let s = String(raw || '').trim();
  const plus = s.startsWith('+') || s.startsWith('00');
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('00')) digits = digits.slice(2);
  if (!plus) {
    if (digits.length === 10) digits = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  }
  return /^\d{10,15}$/.test(digits) ? `+${digits}` : null;
}

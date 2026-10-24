/**
 * One-time codes sent to a phone number, for signing up and for resetting a
 * password. The code is 6 digits, lives 10 minutes, allows 5 attempts, and is
 * sent through whichever SMS provider is configured:
 *
 *   console  (default)  prints the code in the server log. While the demo
 *                       password is in use the code is also returned to the
 *                       app, so testers can sign up without an SMS account.
 *   msg91               https://msg91.com  (MSG91_AUTH_KEY, MSG91_TEMPLATE_ID)
 *   twilio              https://twilio.com (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM)
 *
 * Verifying a code returns a short-lived token that proves the phone was
 * verified; register and reset need that token.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { config } from '../config.js';
import { normalizePhone } from '../phone.js';

export { normalizePhone };

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const TOKEN_TTL = '15m';

const stmts = {
  insert: db.prepare(`INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?,?,?, datetime('now', '+${CODE_TTL_MIN} minutes'))`),
  latest: db.prepare(`SELECT * FROM otp_codes WHERE phone = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`),
  bump: db.prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`),
  use: db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`),
  retire: db.prepare(`UPDATE otp_codes SET used = 1 WHERE phone = ? AND purpose = ? AND used = 0`),
};

async function deliver(phone, code) {
  const text = `${config.company.name}: your verification code is ${code}. It expires in ${CODE_TTL_MIN} minutes.`;
  const p = config.sms;
  if (p.provider === 'msg91' && p.msg91AuthKey) {
    const res = await fetch('https://control.msg91.com/api/v5/otp?' + new URLSearchParams({ template_id: p.msg91TemplateId, mobile: phone.replace('+', ''), otp: code }), {
      method: 'POST',
      headers: { authkey: p.msg91AuthKey, 'content-type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Object.assign(new Error('The SMS service could not send the code. Try again in a minute.'), { status: 502, logged: true });
    return { sent: 'sms' };
  }
  if (p.provider === 'twilio' && p.twilioSid) {
    const auth = Buffer.from(`${p.twilioSid}:${p.twilioToken}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${p.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: p.twilioFrom, Body: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Object.assign(new Error('The SMS service could not send the code. Try again in a minute.'), { status: 502, logged: true });
    return { sent: 'sms' };
  }
  // console: for development and the demo
  console.log(`[otp] ${phone}: ${code}`);
  return { sent: 'console', demo_code: config.demoPassword === 'password' ? code : undefined };
}

/** Make and send a code. Any older unused code for the same phone and purpose stops working. */
export async function sendOtp(rawPhone, purpose) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw Object.assign(new Error('Enter a valid mobile number, for example +91 98765 43210'), { status: 400 });
  if (!['signup', 'reset'].includes(purpose)) throw Object.assign(new Error('Unknown purpose'), { status: 400 });
  if (purpose === 'reset' && !db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
    throw Object.assign(new Error('No account uses that number'), { status: 404 });
  }
  if (purpose === 'signup' && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
    throw Object.assign(new Error('That number already has an account. Log in, or reset the password.'), { status: 409 });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  stmts.retire.run(phone, purpose);
  stmts.insert.run(phone, code, purpose);
  const out = await deliver(phone, code);
  return { phone, expires_in_min: CODE_TTL_MIN, ...out };
}

/** Check a code; on success hand back a token that register/reset accept for this phone. */
export function verifyOtp(rawPhone, code, purpose) {
  const phone = normalizePhone(rawPhone);
  const row = phone ? stmts.latest.get(phone, purpose) : null;
  if (!row) throw Object.assign(new Error('Ask for a new code first'), { status: 400 });
  if (new Date(`${row.expires_at.replace(' ', 'T')}Z`) < new Date()) throw Object.assign(new Error('That code has expired. Ask for a new one.'), { status: 400 });
  if (row.attempts >= MAX_ATTEMPTS) throw Object.assign(new Error('Too many wrong tries. Ask for a new code.'), { status: 429 });
  if (String(code || '').trim() !== row.code) {
    stmts.bump.run(row.id);
    throw Object.assign(new Error('Wrong code'), { status: 400 });
  }
  stmts.use.run(row.id);
  return { phone, otp_token: jwt.sign({ phone, purpose }, config.jwtSecret, { expiresIn: TOKEN_TTL }) };
}

/** The phone a verification token stands for, or null. */
export function phoneFromToken(token, purpose) {
  try {
    const p = jwt.verify(token, config.jwtSecret);
    return p.purpose === purpose ? p.phone : null;
  } catch {
    return null;
  }
}

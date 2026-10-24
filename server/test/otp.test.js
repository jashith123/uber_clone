/**
 * Phone verification codes: sent for signing up and for resetting a password,
 * checked with a small number of tries, and traded for a short-lived token that
 * register/reset accept. Runs on the console provider, which hands the code
 * back while the demo password is in use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { normalizePhone } = await import('../src/phone.js');
const { sendOtp, verifyOtp, phoneFromToken } = await import('../src/services/otp.js');

test('phone numbers are stored one way', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizePhone('98765-43210'), '+919876543210');
  assert.equal(normalizePhone('09876543210'), '+919876543210');
  assert.equal(normalizePhone('0091 9876543210'), '+919876543210');
  assert.equal(normalizePhone('+1 (415) 555-0100'), '+14155550100');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('a signup code is sent, a wrong code is refused, the right one gives a token for that purpose only', async () => {
  const sent = await sendOtp('98765 43210', 'signup');
  assert.equal(sent.phone, '+919876543210');
  assert.match(sent.demo_code, /^[0-9]{6}$/, 'the demo returns the code so testers can sign up');

  assert.throws(() => verifyOtp('+919876543210', '000000', 'signup'), /Wrong code/);
  const ok = verifyOtp('+91 98765 43210', sent.demo_code, 'signup');
  assert.equal(ok.phone, '+919876543210');
  assert.equal(phoneFromToken(ok.otp_token, 'signup'), '+919876543210');
  assert.equal(phoneFromToken(ok.otp_token, 'reset'), null, 'a signup token cannot reset a password');
  assert.equal(phoneFromToken('garbage', 'signup'), null);

  // A code works once.
  assert.throws(() => verifyOtp('+919876543210', sent.demo_code, 'signup'), /Ask for a new code/);
});

test('asking again retires the older code', async () => {
  const first = await sendOtp('+919876500001', 'signup');
  const second = await sendOtp('+919876500001', 'signup');
  assert.throws(() => verifyOtp('+919876500001', first.demo_code, 'signup'), /Wrong code|Ask for a new code/);
  assert.ok(verifyOtp('+919876500001', second.demo_code, 'signup').otp_token);
});

test('five wrong tries lock the code; an expired code is refused', async () => {
  const sent = await sendOtp('+919876500002', 'signup');
  for (let i = 0; i < 5; i++) assert.throws(() => verifyOtp('+919876500002', '111111', 'signup'), /Wrong code/);
  assert.throws(() => verifyOtp('+919876500002', sent.demo_code, 'signup'), /Too many wrong tries/);

  const again = await sendOtp('+919876500002', 'signup');
  db.prepare(`UPDATE otp_codes SET expires_at = datetime('now', '-1 minute') WHERE phone = ? AND used = 0`).run('+919876500002');
  assert.throws(() => verifyOtp('+919876500002', again.demo_code, 'signup'), /expired/);
});

test('reset codes only go to numbers with an account; signup codes only to numbers without one', async () => {
  await assert.rejects(sendOtp('+919876500003', 'reset'), /No account uses that number/);
  db.prepare('INSERT INTO users (role,name,email,phone,password_hash) VALUES (?,?,?,?,?)').run('customer', 'P', 'p@t.com', '+919876500003', hashPassword('x'));
  await assert.rejects(sendOtp('+919876500003', 'signup'), /already has an account/);
  const sent = await sendOtp('98765 00003', 'reset');
  const ok = verifyOtp('+919876500003', sent.demo_code, 'reset');
  assert.equal(phoneFromToken(ok.otp_token, 'reset'), '+919876500003');
});

test('a bad number or purpose is refused before anything is sent', async () => {
  await assert.rejects(sendOtp('12', 'signup'), /valid mobile number/);
  await assert.rejects(sendOtp('+919876500004', 'login'), /Unknown purpose/);
});

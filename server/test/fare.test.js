import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFare, quoteAll } from '../src/services/fare.js';
import { DEFAULT_PRICING } from '../src/db.js';

const go = DEFAULT_PRICING.find((p) => p.vehicle_type === 'economy');
const goRow = { ...go, currency: 'INR' };

test('fare = base + per_km*km + per_min*min + booking fee', () => {
  const { total, breakdown } = computeFare(goRow, 10, 20);
  // 30 + 12*10 + 1*20 + 5 = 175
  assert.equal(total, 175);
  assert.equal(breakdown.distance_charge, 120);
  assert.equal(breakdown.time_charge, 20);
  assert.equal(breakdown.min_fare_applied, false);
});

test('minimum fare floors very short trips', () => {
  const { total, breakdown } = computeFare(goRow, 0.5, 2);
  // 30 + 6 + 2 + 5 = 43 < min 50
  assert.equal(total, 50);
  assert.equal(breakdown.min_fare_applied, true);
});

test('longer route costs more (customer-chosen route drives the price)', () => {
  const short = computeFare(goRow, 19.75, 24.2).total;
  const long = computeFare(goRow, 24.67, 30).total;
  assert.ok(long > short);
  assert.equal(short, 296.2); // 30 + 12*19.75 + 1*24.2 + 5
});

test('negative / NaN inputs are clamped to zero', () => {
  const { total } = computeFare(goRow, -5, NaN);
  assert.equal(total, goRow.min_fare);
});

test('quoteAll returns one quote per vehicle class, sorted as given', () => {
  const quotes = quoteAll(DEFAULT_PRICING.map((p) => ({ ...p, currency: 'INR' })), 10, 15);
  assert.equal(quotes.length, DEFAULT_PRICING.length);
  assert.deepEqual(
    quotes.map((q) => q.vehicle_type),
    DEFAULT_PRICING.map((p) => p.vehicle_type),
  );
  for (let i = 1; i < quotes.length; i++) assert.ok(quotes[i].fare > quotes[i - 1].fare, 'higher classes cost more');
});

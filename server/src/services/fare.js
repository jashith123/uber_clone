/**
 * Fare engine.
 *
 * The core product idea: the customer chooses the exact route, and the fare is
 * computed from the kilometres of THAT route (plus a small time component and a
 * booking fee), floored at a minimum fare. Every number here is derived from a
 * pricing row so tariffs can be changed in the DB without touching code.
 */

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} pricing  row from the `pricing` table
 * @param {number} distanceKm
 * @param {number} durationMin
 * @returns {{ total:number, breakdown:object }}
 */
export function computeFare(pricing, distanceKm, durationMin) {
  const km = Math.max(0, Number(distanceKm) || 0);
  const min = Math.max(0, Number(durationMin) || 0);

  const distanceCharge = round2(pricing.per_km * km);
  const timeCharge = round2(pricing.per_min * min);
  const subtotal = round2(pricing.base_fare + distanceCharge + timeCharge);
  const withFee = round2(subtotal + pricing.booking_fee);
  const total = round2(Math.max(withFee, pricing.min_fare));

  return {
    total,
    breakdown: {
      vehicle_type: pricing.vehicle_type,
      currency: pricing.currency,
      distance_km: round2(km),
      duration_min: round2(min),
      base_fare: pricing.base_fare,
      per_km: pricing.per_km,
      distance_charge: distanceCharge,
      per_min: pricing.per_min,
      time_charge: timeCharge,
      booking_fee: pricing.booking_fee,
      min_fare: pricing.min_fare,
      min_fare_applied: withFee < pricing.min_fare,
      subtotal: withFee,
      total,
    },
  };
}

/** Quote every vehicle class for a given route. */
export function quoteAll(pricingRows, distanceKm, durationMin) {
  return pricingRows.map((p) => {
    const { total, breakdown } = computeFare(p, distanceKm, durationMin);
    return {
      vehicle_type: p.vehicle_type,
      label: p.label,
      description: p.description,
      seats: p.seats,
      currency: p.currency,
      fare: total,
      breakdown,
    };
  });
}

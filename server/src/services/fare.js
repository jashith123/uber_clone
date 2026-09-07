/**
 * Fare engine.
 *
 * The core product idea: the customer chooses the exact route, and the fare is
 * computed from the kilometres of THAT route (plus a small time component and a
 * booking fee), floored at a minimum fare. Every number here is derived from a
 * pricing row so tariffs can be changed in the DB without touching code.
 *
 *   distance_charge = per_km  x km   x surge
 *   time_charge     = per_min x min  x surge
 *   subtotal        = base + distance_charge + time_charge + booking_fee
 *   total           = max(subtotal, min_fare) - discount
 *
 * Surge never applies to the base fare or the booking fee, and the discount is
 * applied after the minimum-fare floor so a promo can take a fare below it.
 */

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} pricing  row from the `pricing` table
 * @param {number} distanceKm
 * @param {number} durationMin
 * @param {{surge?:number, discount?:number, surgeReason?:string|null}} [opts]
 * @returns {{ total:number, breakdown:object }}
 */
export function computeFare(pricing, distanceKm, durationMin, opts = {}) {
  const km = Math.max(0, Number(distanceKm) || 0);
  const min = Math.max(0, Number(durationMin) || 0);
  const surge = Math.max(1, Number(opts.surge) || 1);
  const wantedDiscount = Math.max(0, Number(opts.discount) || 0);

  const distanceCharge = round2(pricing.per_km * km * surge);
  const timeCharge = round2(pricing.per_min * min * surge);
  const subtotal = round2(pricing.base_fare + distanceCharge + timeCharge + pricing.booking_fee);
  const beforeDiscount = round2(Math.max(subtotal, pricing.min_fare));
  const discount = round2(Math.min(wantedDiscount, beforeDiscount));
  const total = round2(beforeDiscount - discount);

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
      min_fare_applied: subtotal < pricing.min_fare,
      surge_multiplier: surge,
      surge_reason: opts.surgeReason || null,
      subtotal: beforeDiscount,
      discount,
      promo_code: opts.promoCode || null,
      total,
    },
  };
}

/** Quote every vehicle class for a given route. */
export function quoteAll(pricingRows, distanceKm, durationMin, perTypeOpts = {}) {
  return pricingRows.map((p) => {
    const opts = perTypeOpts[p.vehicle_type] || perTypeOpts._all || {};
    const { total, breakdown } = computeFare(p, distanceKm, durationMin, opts);
    return {
      vehicle_type: p.vehicle_type,
      label: p.label,
      description: p.description,
      seats: p.seats,
      currency: p.currency,
      fare: total,
      surge_multiplier: breakdown.surge_multiplier,
      surge_reason: breakdown.surge_reason,
      breakdown,
    };
  });
}

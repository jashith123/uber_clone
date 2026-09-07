export type Role = 'customer' | 'driver';

export interface DriverProfile {
  user_id: number;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approval_note?: string | null;
  acceptance_rate?: number;
  vehicle_type: string;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  plate?: string | null;
  is_online: number;
  lat?: number | null;
  lng?: number | null;
  heading?: number | null;
  rating: number;
  rating_count: number;
}

export interface User {
  id: number;
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
  created_at: string;
  is_admin?: number;
  is_blocked?: number;
  driver?: DriverProfile | null;
}

export interface Place {
  label: string;
  name: string;
  lat: number;
  lng: number;
  source?: 'recent' | 'popular' | 'common' | 'search';
}

export interface Waypoint {
  lat: number;
  lng: number;
  address?: string | null;
}

export interface FareBreakdown {
  vehicle_type: string;
  currency: string;
  distance_km: number;
  duration_min: number;
  base_fare: number;
  per_km: number;
  distance_charge: number;
  per_min: number;
  time_charge: number;
  booking_fee: number;
  min_fare: number;
  min_fare_applied: boolean;
  surge_multiplier: number;
  surge_reason: string | null;
  subtotal: number;
  discount: number;
  promo_code: string | null;
  total: number;
}

export interface Quote {
  vehicle_type: string;
  label: string;
  description: string;
  seats: number;
  currency: string;
  fare: number;
  surge_multiplier: number;
  surge_reason: string | null;
  breakdown: FareBreakdown;
}

export interface RouteOption {
  index: number;
  distance_km: number;
  duration_min: number;
  geometry: [number, number][];
  legs: { distance_km: number; duration_min: number }[];
  quotes: Quote[];
}

export type RideStatus = 'requested' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

export interface RideDriver {
  id: number;
  name: string;
  phone?: string | null;
  vehicle_type?: string;
  vehicle?: string | null;
  plate?: string | null;
  rating: number;
  lat?: number | null;
  lng?: number | null;
  heading?: number | null;
}

export interface Ride {
  id: number;
  customer_id: number;
  driver_id: number | null;
  status: RideStatus;
  vehicle_type: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string | null;
  waypoints: Waypoint[];
  route_index: number;
  route_geometry: [number, number][];
  distance_km: number;
  duration_min: number;
  fare_estimate: number;
  fare_final: number | null;
  fare_breakdown: FareBreakdown;
  currency: string;
  payment_method: string;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancel_fee: number;
  driver_penalty: number;
  cancel_policy: { customer_fee: number; driver_penalty: number; grace_ends_at: string | null };
  pin: string | null;
  pin_required: boolean;
  share_token: string;
  surge_multiplier: number;
  promo_code: string | null;
  discount: number;
  payment_status: 'pending' | 'paid' | 'failed';
  driver_eta_min: number | null;
  dispatch_state: 'idle' | 'searching' | 'no_drivers';
  customer_rating: number | null;
  driver_rating: number | null;
  created_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  customer: { id: number; name: string; phone?: string | null } | null;
  driver: RideDriver | null;
  pickup_distance_km?: number;
}

export interface Pricing {
  vehicle_type: string;
  label: string;
  description: string;
  seats: number;
  base_fare: number;
  per_km: number;
  per_min: number;
  min_fare: number;
  booking_fee: number;
  cancel_fee: number;
  currency: string;
  sort_order: number;
}

export interface DriverLocation {
  ride_id: number;
  driver_id: number;
  lat: number;
  lng: number;
  heading: number | null;
  eta_min?: number;
  distance_km?: number;
}

// ---------------------------------------------------------------- money ----
export interface Wallet {
  user_id: number;
  balance: number;
  currency: string;
}

export interface WalletTx {
  id: number;
  user_id: number;
  amount: number;
  balance_after: number;
  type: string;
  ride_id: number | null;
  note: string | null;
  created_at: string;
}

export interface PaymentConfig {
  provider: 'mock' | 'razorpay' | 'stripe';
  live: boolean;
  key_id: string | null;
  currency: string;
  commission_percent: number;
}

export interface Promo {
  code: string;
  description: string;
  kind: 'percent' | 'flat';
  value: number;
  max_discount: number;
  min_fare: number;
  active?: number;
  per_user_limit?: number;
  total_limit?: number;
  used_count?: number;
  expires_at?: string | null;
}

export interface PromoCheck {
  ok: boolean;
  code?: string;
  description?: string;
  reason?: string;
}

// ------------------------------------------------------------- dispatch ----
export interface RideOffer extends Ride {
  offer_id: number;
  offer_expires_at: string;
  wave: number;
}

export interface OfferEvent {
  driver_id: number;
  ride_id: number;
  wave: number;
  expires_in: number;
  distance_km: number;
}

export interface DispatchSearching {
  ride_id: number;
  wave: number;
  offered_to: number;
}

// --------------------------------------------------------------- safety ----
export interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
}

export interface SosAlert {
  id: number;
  ride_id: number | null;
  user_id: number;
  user_name?: string;
  user_phone?: string;
  role: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  created_at: string;
}

export interface PublicTrip {
  id: number;
  status: RideStatus;
  rider: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  waypoints: Waypoint[];
  route_geometry: [number, number][];
  distance_km: number;
  duration_min: number;
  created_at: string;
  completed_at: string | null;
  driver: { name: string; vehicle: string; plate: string; rating: number; lat: number | null; lng: number | null; heading: number | null } | null;
}

// ----------------------------------------------------------- onboarding ----
export interface DriverDocument {
  id: number;
  kind: string;
  file_path: string;
  number: string | null;
  expires_on: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- admin ----
export interface AdminStats {
  users: { riders: number; drivers: number; blocked: number };
  drivers_online: number;
  pending_approvals: number;
  rides: { total: number; completed: number; cancelled: number; active: number };
  today: { rides: number; gross: number; km: number };
  revenue: { gross_fares: number; cancel_fees: number };
  commission: number;
  open_sos: number;
}

export interface AdminUser {
  id: number;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
  is_admin: number;
  is_blocked: number;
  created_at: string;
  vehicle_type: string | null;
  approval_status: string | null;
  is_online: number | null;
  rating: number | null;
  acceptance_rate: number | null;
  plate: string | null;
  balance: number;
  rides: number;
}

export interface SurgeZone {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
  multiplier: number;
  active: number;
}

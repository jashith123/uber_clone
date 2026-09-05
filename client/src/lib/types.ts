export type Role = 'customer' | 'driver';

export interface DriverProfile {
  user_id: number;
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
  subtotal: number;
  total: number;
}

export interface Quote {
  vehicle_type: string;
  label: string;
  description: string;
  seats: number;
  currency: string;
  fare: number;
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
}

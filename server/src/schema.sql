PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL CHECK (role IN ('customer','driver')),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type  TEXT NOT NULL DEFAULT 'economy',
  vehicle_make  TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  plate         TEXT,
  is_online     INTEGER NOT NULL DEFAULT 0,
  lat           REAL,
  lng           REAL,
  heading       REAL,
  rating        REAL NOT NULL DEFAULT 5.0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  location_at   TEXT
);

CREATE TABLE IF NOT EXISTS pricing (
  vehicle_type  TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL,
  seats         INTEGER NOT NULL,
  base_fare     REAL NOT NULL,
  per_km        REAL NOT NULL,
  per_min       REAL NOT NULL,
  min_fare      REAL NOT NULL,
  booking_fee   REAL NOT NULL DEFAULT 0,
  cancel_fee    REAL NOT NULL DEFAULT 0,   -- charged to a customer who cancels late
  currency      TEXT NOT NULL DEFAULT 'INR',
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rides (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id      INTEGER NOT NULL REFERENCES users(id),
  driver_id        INTEGER REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','accepted','arrived','in_progress','completed','cancelled')),
  vehicle_type     TEXT NOT NULL,
  pickup_lat       REAL NOT NULL,
  pickup_lng       REAL NOT NULL,
  pickup_address   TEXT,
  dropoff_lat      REAL NOT NULL,
  dropoff_lng      REAL NOT NULL,
  dropoff_address  TEXT,
  waypoints        TEXT NOT NULL,        -- JSON: ordered list of {lat,lng,address} incl. pickup and dropoff
  route_index      INTEGER NOT NULL DEFAULT 0,
  route_geometry   TEXT NOT NULL,        -- JSON: [[lat,lng], ...]
  distance_km      REAL NOT NULL,
  duration_min     REAL NOT NULL,
  fare_estimate    REAL NOT NULL,
  fare_final       REAL,
  fare_breakdown   TEXT NOT NULL,        -- JSON
  currency         TEXT NOT NULL DEFAULT 'INR',
  payment_method   TEXT NOT NULL DEFAULT 'cash',
  cancel_reason    TEXT,
  cancelled_by     TEXT,
  cancel_fee       REAL NOT NULL DEFAULT 0, -- charged to the customer (+ for the driver)
  driver_penalty   REAL NOT NULL DEFAULT 0, -- deducted from the driver
  customer_rating  INTEGER,
  driver_rating    INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at      TEXT,
  arrived_at       TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  cancelled_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_rides_customer ON rides(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_driver   ON rides(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_status   ON rides(status);

CREATE TABLE IF NOT EXISTS ride_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  actor_id   INTEGER,
  type       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ride_events_ride ON ride_events(ride_id, id);

CREATE TABLE IF NOT EXISTS ride_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ride_messages_ride ON ride_messages(ride_id, id);

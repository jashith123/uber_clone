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

-- ============================================================
-- Phase 6: dispatch, payments, promos, safety, onboarding, admin
-- ============================================================

-- One offer of a ride to one driver. The dispatcher creates these in waves.
CREATE TABLE IF NOT EXISTS ride_offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id     INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id   INTEGER NOT NULL REFERENCES users(id),
  wave        INTEGER NOT NULL DEFAULT 1,
  distance_km REAL,
  status      TEXT NOT NULL DEFAULT 'offered'
              CHECK (status IN ('offered','accepted','declined','expired','cancelled')),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_offers_ride   ON ride_offers(ride_id, id);
CREATE INDEX IF NOT EXISTS idx_offers_driver ON ride_offers(driver_id, status);

-- Money held per user. Riders top up; drivers accrue earnings and withdraw.
CREATE TABLE IF NOT EXISTS wallets (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance    REAL NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every movement of money. amount is signed: + into the wallet, - out of it.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  balance_after REAL NOT NULL,
  type        TEXT NOT NULL,   -- topup | ride_fare | ride_earning | cancel_fee | cancel_penalty | payout | refund | promo | adjustment
  ride_id     INTEGER REFERENCES rides(id),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, id DESC);

-- A payment attempt against a gateway (or the built-in mock gateway).
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  ride_id      INTEGER REFERENCES rides(id),
  purpose      TEXT NOT NULL DEFAULT 'wallet_topup',  -- wallet_topup | ride
  provider     TEXT NOT NULL DEFAULT 'mock',          -- mock | razorpay | stripe
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'INR',
  status       TEXT NOT NULL DEFAULT 'created'        -- created | paid | failed | refunded
               CHECK (status IN ('created','paid','failed','refunded')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, id DESC);

CREATE TABLE IF NOT EXISTS promo_codes (
  code          TEXT PRIMARY KEY COLLATE NOCASE,
  description   TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','flat')),
  value         REAL NOT NULL,
  max_discount  REAL NOT NULL DEFAULT 0,   -- 0 = no cap
  min_fare      REAL NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  total_limit   INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  used_count    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  expires_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL REFERENCES promo_codes(code),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  ride_id    INTEGER REFERENCES rides(id),
  discount   REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions ON promo_redemptions(code, user_id);

-- Driver onboarding paperwork, reviewed by an admin.
CREATE TABLE IF NOT EXISTS driver_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,   -- licence | rc | insurance | permit | photo
  file_path   TEXT NOT NULL,
  number      TEXT,
  expires_on  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_driver ON driver_documents(driver_id, kind);

-- Web push subscriptions (one row per browser / installed app).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Emergency button presses.
CREATE TABLE IF NOT EXISTS sos_alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id    INTEGER REFERENCES rides(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL,
  lat        REAL,
  lng        REAL,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  handled_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- People a rider trusts; they receive the trip-share link on SOS.
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON emergency_contacts(user_id);

-- Per-area demand multiplier, set by an admin or by the demand job.
CREATE TABLE IF NOT EXISTS surge_zones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius_km  REAL NOT NULL DEFAULT 3,
  multiplier REAL NOT NULL DEFAULT 1,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

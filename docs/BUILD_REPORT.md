# SwiftRide — Build Report

Date: 5 September 2026 (updated the same day with phase 2: theme, chat, calls, PWA, Docker)
Project: `C:\Projects\Ideas\Uber`
Goal: an Uber-style ride-hailing app built from scratch (frontend, backend, database), with separate customer and driver accounts, working ride requests, and the key differentiator: **the customer chooses the route and the fare is calculated from the kilometres of that route.**

Everything below was built and verified in this one session. Nothing was cloned or copied from an existing project.

---

## 1. What was built

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + Vite 6 + TypeScript | Fast dev loop, type safety, industry standard |
| Map | Leaflet + react-leaflet, OpenStreetMap tiles | Free, no API key, no vendor lock-in |
| Routing | OSRM public server (proxied through the backend) | Free road routing; returns alternative routes and supports via points |
| Geocoding | Nominatim (proxied through the backend) | Free address search and reverse geocoding |
| Backend | Node 24 + Express 4 | Simple, well known, fast to iterate |
| Realtime | Socket.IO | Driver location, new requests, status changes pushed live to both sides |
| Database | SQLite via Node's built-in `node:sqlite` | Zero native build steps on Windows, single file, trivially swappable for Postgres later |
| Auth | JWT (7-day) + bcrypt password hashes | Stateless, works for web and future mobile clients |
| Tests | Node's built-in test runner | 11 unit tests for the fare engine and ride state machine, no network needed |

### Repository layout

```
Uber/
├── package.json              # root scripts: install:all, dev, seed, test, build
├── README.md                 # how to run + demo accounts
├── server/
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.js          # boots HTTP + Socket.IO
│   │   ├── app.js            # Express app, routes, error handler
│   │   ├── config.js         # env-driven settings
│   │   ├── db.js             # opens SQLite, applies schema, seeds tariff
│   │   ├── schema.sql        # tables + indexes
│   │   ├── auth.js           # hashing, JWT, requireAuth / requireRole middleware
│   │   ├── realtime.js       # Socket.IO rooms and events
│   │   ├── seed.js           # demo customers and drivers
│   │   ├── routes/           # auth, geo, rides, drivers
│   │   └── services/         # fare.js, geo.js, rides.js, drivers.js
│   └── test/                 # fare.test.js, rides.test.js
├── client/
│   ├── index.html, vite.config.ts, tsconfig.json
│   └── src/
│       ├── main.tsx, App.tsx, styles.css
│       ├── lib/              # api, auth context, socket, geo helpers, formatting, types
│       ├── components/       # MapView, PlaceSearch, RideStatusCard, TopNav
│       └── pages/            # Landing, Login, Signup, customer/*, driver/*
└── docs/
    ├── BUILD_REPORT.md       # this file
    └── screenshots/          # captured from the running app
```

Roughly 4,200 lines of source across server and client.

---

## 2. The core concept: customer-chosen route, per-km fare

### How the customer chooses a route

1. Customer sets pickup and destination by searching an address, clicking the map, or using their current location.
2. The app asks the backend for route options. With two points OSRM returns up to three alternatives, drawn as grey lines on the map with the chosen one in black. Clicking a grey line or a route card selects it.
3. The customer can press **Add a stop / via point** and click anywhere on the map. The route is recomputed to pass through that point, in order. Up to five via points are allowed.
4. Every pin (pickup, stops, destination) is draggable, so the customer can fine-tune the road they want.
5. Each route card shows kilometres, minutes, and the fare for the selected vehicle class. The fare formula is printed underneath so the price is never a mystery.

### Fare formula

```
fare = max( min_fare,
            base_fare + per_km × distance_km + per_min × duration_min + booking_fee )
```

Tariffs live in the `pricing` table and can be changed without touching code:

| Class | Base | Per km | Per min | Min fare | Booking fee |
| --- | --- | --- | --- | --- | --- |
| Moto (`bike`) | ₹15 | ₹6 | ₹0.50 | ₹25 | ₹2 |
| Go (`economy`) | ₹30 | ₹12 | ₹1 | ₹50 | ₹5 |
| Comfort (`comfort`) | ₹50 | ₹16 | ₹1.50 | ₹80 | ₹8 |
| XL (`xl`) | ₹70 | ₹22 | ₹2 | ₹120 | ₹10 |

Currency defaults to INR. These numbers are placeholders chosen to be plausible for an Indian city and should be replaced with real tariffs.

### Why the server recomputes the fare

The browser sends only the waypoints and which alternative was picked. The server calls OSRM again itself, measures the route, and computes the fare from the tariff table. A tampered client cannot lower the price.

Verified in the session: the same pickup and destination priced at ₹308.45 for the direct 20.7 km route and ₹393.24 after adding a via point that made it 27.1 km.

---

## 3. Accounts and roles

Two roles share one `users` table; drivers get an extra `driver_profiles` row.

**Customer** can: sign up, log in, search places, plan a route with stops, see quotes for all vehicle classes, pick a payment method (cash, card, wallet, recorded only), request a ride, watch the driver approach live, cancel while waiting, see a receipt, rate the driver, view trip history.

**Driver** can: sign up with vehicle details (class, make, model, colour, plate), go online or offline, see ride requests for their vehicle class sorted by distance to pickup, preview the request's route on the map, accept a ride (first driver wins, atomically), progress the ride through Arrived, Start trip, Complete trip, cancel before the trip starts, rate the rider, see earnings for today and all time, view trip history, edit vehicle details.

Demo accounts (created by `npm run seed`, all with password `password`): `customer@demo.com`, `rider2@demo.com`, `driver@demo.com` (Go), `driver2@demo.com` (Comfort), `driver3@demo.com` (XL).

---

## 4. Ride lifecycle

```
requested ──accept──▶ accepted ──arrived──▶ arrived ──start──▶ in_progress ──complete──▶ completed
    │                    │                     │
    └──────── cancel ────┴──────── cancel ─────┘──▶ cancelled
```

Rules enforced by the server:

- A customer can have only one active ride at a time.
- A driver must be online and must not have an active ride to accept.
- Accepting uses a single conditional UPDATE, so two drivers tapping at once cannot both win.
- Only the assigned driver can advance the ride; transitions outside the diagram are rejected.
- Completing copies the estimate into `fare_final`.
- Ratings are 1 to 5, once per side, only on completed rides. Driver ratings feed a running average on the profile.
- Every change is appended to `ride_events` for an audit trail.

---

## 5. Realtime

Socket.IO with JWT authentication on connect.

| Event | Direction | Who receives it |
| --- | --- | --- |
| `ride:new` | server to client | online drivers in the ride's vehicle class |
| `ride:taken` | server to client | other drivers, so the request disappears from their list |
| `ride:update` | server to client | the customer and driver on that ride |
| `driver:location` | client to server | driver sends GPS; server stores it and forwards to the customer |
| `driver:location` | server to client | the customer of the driver's active ride |

Because desktop browsers often have no GPS, the driver screen has a **Simulate GPS** toggle. When on, the car drives itself towards the pickup and then along the chosen route, so the whole flow can be demonstrated on one machine. It switches on automatically if the browser denies geolocation.

---

## 6. API summary

All routes are under `/api`. Authenticated routes need `Authorization: Bearer <token>`.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | create customer or driver (with vehicle) |
| POST | `/auth/login` | public | get token |
| GET | `/auth/me` | any | current user (+ driver profile) |
| GET | `/geo/pricing` | public | tariff table |
| GET | `/geo/geocode?q=&lat=&lng=` | any | address search, biased near the user |
| GET | `/geo/reverse?lat=&lng=` | any | coordinates to address |
| POST | `/geo/routes` | any | `{waypoints:[{lat,lng}...]}` returns route options, each with quotes for every class |
| GET | `/drivers/nearby?lat=&lng=` | any | online drivers with a position, for the map |
| POST | `/rides` | customer | `{waypoints, route_index, vehicle_type, payment_method}` |
| GET | `/rides` | any | my ride history |
| GET | `/rides/active` | any | my current ride, if any |
| GET | `/rides/available` | driver | open requests for my class, nearest first |
| GET | `/rides/:id` | party | ride + event log |
| POST | `/rides/:id/accept` | driver | claim the ride |
| POST | `/rides/:id/arrived`, `/start`, `/complete` | driver | advance status |
| POST | `/rides/:id/cancel` | party | cancel with reason |
| POST | `/rides/:id/rate` | party | `{stars}` |
| PUT | `/drivers/me` | driver | vehicle details |
| POST | `/drivers/me/status` | driver | `{online: true|false}` |
| POST | `/drivers/me/location` | driver | `{lat, lng, heading}` (also available over the socket) |
| GET | `/drivers/me/earnings` | driver | today and all-time totals |

---

## 7. Database schema

- `users` — id, role (customer|driver), name, email (unique), phone, password_hash, created_at
- `driver_profiles` — user_id, vehicle_type, make, model, colour, plate, is_online, lat, lng, heading, rating, rating_count, location_at
- `pricing` — vehicle_type, label, description, seats, base_fare, per_km, per_min, min_fare, booking_fee, currency, sort_order
- `rides` — customer_id, driver_id, status, vehicle_type, pickup/dropoff coordinates and addresses, waypoints (JSON), route_index, route_geometry (JSON polyline), distance_km, duration_min, fare_estimate, fare_final, fare_breakdown (JSON), currency, payment_method, cancel fields, ratings, timestamps for every state
- `ride_events` — ride_id, actor_id, type, payload, created_at

Indexes on rides by customer, by driver, and by status.

---

## 8. UI

Uber's visual language was used as the reference: black top bar, white side panel next to a full-height map, black primary buttons, grey rounded inputs, Inter typeface, pill status badges. The layout collapses to a map-on-top, panel-below arrangement on narrow screens.

Screens: Landing, Login (with demo shortcuts), Signup (rider or driver toggle, vehicle fields), Ride (plan, choose route, choose class, book, track, receipt, rate), My trips, Drive (online toggle, requests, active ride controls), Earnings, Vehicle.

Screenshots captured from the running app are in `docs/screenshots/`:

- `landing.png` — marketing page
- `ride-routes.png` — route options and quotes for Connaught Place to the airport
- `ride-custom-route.png` — the same trip after adding a via point (fare went up with the km)
- `driver-requests.png` — driver sees the request with fare, distance, stop, and distance to pickup
- `driver-accepted.png`, `driver-on-trip.png`, `driver-completed.png` — driver side of the trip
- `customer-driver-on-way.png`, `customer-receipt.png`, `customer-trips.png` — customer side
- `driver-earnings.png` — earnings page

---

## 9. Verification performed

1. **Backend smoke test against real services**: login both roles, geocode an address, fetch routes and quotes, fetch a via-point route, create a ride, driver sees it, accept, arrived, start, complete, rate, earnings, duplicate accept rejected. All passed.
2. **Unit tests** (`npm test`): 11 tests covering the fare formula, minimum fare, input clamping, per-class ordering, happy-path state machine, double accept, driver busy, illegal transitions, stranger access. All pass.
3. **Type check**: `tsc -b` clean.
4. **Browser walkthrough** with two logged-in tabs (customer on localhost, driver on 127.0.0.1): search, select, add a stop, book, driver accepts, customer sees "Driver on the way" and the moving car, driver completes, both see the receipt, customer rates, trips and earnings pages render.

One environment note: in the automated browser session, native mouse clicks stopped reaching the page part-way through (not even a document-level listener saw them), so the remainder of the walkthrough dispatched DOM events from inside the page. Keyboard input, navigation, and the first clicks worked normally, and the same handlers responded to the dispatched events, so this is a quirk of the automation session rather than the app. Please click through once by hand to confirm.

---

## 10. Fixes made during the session

- Panel stuck on "Loading…" when the browser never answered the geolocation prompt. Geolocation is now best-effort with its own deadline and never blocks the UI.
- CARTO map tiles started demanding an API key; switched to standard OpenStreetMap tiles.
- The nearby-drivers endpoint was mounted after the driver-only router and would have returned 403 for customers; reordered.
- Server entry split into `app.js` and `index.js` so tests can import the app without opening a port.
- CORS accepts both `localhost` and `127.0.0.1` origins so two roles can be tested side by side.

---

## 11. Assumptions made

- Currency INR and Delhi as the default map centre, based on the phone number style and the seed data. Both are one-line changes.
- Fare uses distance plus a small time component. If you want a pure per-km fare, set `per_min` to 0 in the pricing table.
- Payment methods are recorded only; no payment gateway yet.
- Public OSRM and Nominatim demo servers are used. They are rate limited and fine for development, but production needs a self-hosted OSRM (or a paid routing API) and a geocoder with an SLA.

---

## 12. Suggested next steps

1. **Matching engine**: today every online driver of the class sees every request. Add radius-based dispatch, offer timeouts, and automatic re-offer to the next driver.
2. **Driver ETA to pickup**: call OSRM from the driver's live position and show minutes to arrival on the customer screen.
3. **Payments**: Razorpay or Stripe for card and wallet; hold on request, capture on completion.
4. **Fare extras**: surge, tolls, waiting time, promo codes, scheduled rides.
5. **Route deviation handling**: if the driver leaves the chosen route, either warn or re-price with customer consent.
6. **Mobile apps**: the API and socket contract are ready for React Native or Flutter clients.
7. **Admin panel**: tariff editing, user management, live map of drivers.
8. **Hardening**: rate limiting, refresh tokens, email or OTP verification, Postgres in production, Docker compose.

---

## 13. Phase 2 additions (same day)

Requested after the first delivery: Docker, website **and** installable app, chat and calling between rider and driver, a way to test on several devices, and a look that is not an Uber copy.

### Own visual identity

- Palette: deep teal for trust and the chosen route, coral for actions and stops, warm off-white page, navy ink. Dark-teal gradient top bar with a coral brand dot.
- Typeface: Manrope (was Inter). Pill-shaped buttons, softer 16px card radius, subtle shadows, gradient accent bar on feature cards.
- Map: selected route in teal, alternatives grey, pickup teal dot, destination navy square, stops coral, live car coral.
- Product name is a single constant in `client/src/lib/brand.ts` so it can be renamed in one place.

### In-ride chat

- New `ride_messages` table; REST endpoints `GET/POST /api/rides/:id/messages`; live delivery to both parties over the socket (`chat:message`).
- Only the two parties may read or write, and only between accept and completion. Unread counter, history survives reloads.

### In-app voice calls (WebRTC)

- Audio-only peer-to-peer call signalled over the existing socket (`call:signal` with offer / answer / ice / end / reject / busy). The server relays only between the customer and driver of an active ride and rejects strangers.
- UI: "Call in app" button, incoming-call banner with Answer / Decline, timer, mute, hang up. Falls back to a plain phone-dialer link. Uses Google STUN; a TURN server is the one thing to add for strict NATs.
- Verified end to end at the signalling level with three socket clients (customer, driver, stranger). Audio requires HTTPS on phones (see the testing guide).

### Installable app (PWA)

- `manifest.webmanifest`, generated PNG icons (192, 512, maskable, Apple touch), service worker that caches the shell and never caches API, socket or map tiles.
- Installs from Chrome on Android ("Install app") and Safari on iPhone ("Add to Home Screen"); opens full screen.
- Production mode serves site + API + socket on **one port** (Express serves `client/dist`), so one tunnel URL is enough for all devices. `npm run serve`, then `npm run tunnel`.

### Docker

- Multi-stage `Dockerfile` (build the site, run the API as a non-root user with a health check) and `docker-compose.yml` with a persistent volume for the SQLite file and `SEED_DEMO=1`.
- Docker is not installed on the build machine, so the image was written and reviewed but not built here.

### Testing guide

`docs/TESTING_GUIDE.md`: setup, getting the app onto phones (LAN or HTTPS tunnel), install steps, a scenario checklist for accounts, routes and fares, ride lifecycle, chat, calls, cancellations and PWA behaviour, Docker, troubleshooting, known limits.

### Name ideas

The code name is SwiftRide. Options that fit "your route, your fare": **Waypoint**, **Apna Rasta** ("your own road"), **Marg** / **MargGo**, **Meterly**, **KiloRide**, **TrueFare**, **Pathly**, **RouteMate**. Rename via `client/src/lib/brand.ts`, the manifest, and the page title.

---

## 14. Phase 3: Android APK

The user has Android Studio, so the web app was wrapped into a native Android app with Capacitor 7.

- `client/capacitor.config.ts`: app id `com.swiftride.app`, bundles `client/dist`, mixed content allowed so the app (origin `https://localhost`) can call the PC's plain-HTTP API during testing.
- `client/android/`: generated Android project. Manifest adds location and microphone permissions and `usesCleartextTraffic`. Launcher icons at every density are generated from the brand design (`client/scripts/make-android-icons.mjs`).
- Release signing with a throwaway development keystore (`client/android/keystore/`, ignored by git; password `swiftride123`). Replace it before any store release.
- The API address is no longer hard-coded as relative: `apiBase()` in `client/src/lib/api.ts` uses the address typed on the login screen, else the `VITE_API_URL` baked in at build time (`http://192.168.29.217:4000` for this APK), else same-origin. The website build stays relative.
- The server now also accepts the native origins `https://localhost` and `capacitor://localhost`.
- Build: `npm run android:build` (bakes the API URL, syncs assets, runs Gradle `assembleRelease`). Gradle 8.14.3 from Android Studio's cache is used because downloading a fresh distribution timed out on this network.
- Output copied to `dist-apk/SwiftRide-release.apk`. Install steps and the server-address workflow are in the testing guide, Option C.
- Not built: iOS (needs a Mac with Xcode; the same Capacitor project supports `npx cap add ios`).

---

## 15. Phase 4: phone layout, money ledger, cancellation policy, emulator test

- **Phone layout**: on screens under 900px the map fills the screen, the planning panel becomes a bottom sheet (drag handle, scrolls independently), navigation moves to a bottom tab bar, the top bar shrinks to brand + avatar, and safe-area insets are respected. The desktop layout is unchanged.
- **Signed money** (per the user's request): every amount is shown with a sign and colour. Driver ledger: `+` fares and late-cancellation fees received, `−` penalties. Customer trips: `−` fares paid and `−` late fees, `₹0` for free cancellations. Receipts show "You paid −₹…" / "You earned +₹…".
- **Cancellation policy** (server-enforced, unit-tested): free while still searching; free within 2 minutes of the driver accepting; otherwise, or after the driver has arrived, the customer pays the class `cancel_fee` (Moto ₹10, Go ₹30, Comfort ₹40, XL ₹50), which goes to the driver. A driver who cancels after accepting is deducted a flat ₹20. The app warns before the button is pressed and shows the outcome afterwards. Existing databases are migrated automatically (new `cancel_fee`, `driver_penalty` columns).
- **Guard**: a ride whose route is under 200 m is rejected ("too close together").
- **Theme**: at the user's request the palette went back to the original black-and-white look. All colours are CSS variables in `:root`, so switching palettes is a one-block change.
- **Emulator test**: the APK was installed on the Android Studio emulator (Medium Phone, API 36.1). It reached the PC's API over the LAN address, logged in, showed the live map with nearby cars, and computed routes and quotes for a real address search. Screenshots in `docs/screenshots/emulator/`.
- **Git**: the project is pushed to https://github.com/jashith123/uber_clone (branch `master`).

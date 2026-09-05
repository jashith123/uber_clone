# SwiftRide

Ride hailing where **the customer picks the route and pays per kilometre**. Built from scratch: React web app (installable on phones as a PWA), Node/Express API, SQLite, Socket.IO realtime, in-ride chat and WebRTC voice calls.

## Run it

```bash
npm run install:all        # once: root, server and client deps
npm run seed               # demo accounts (safe to re-run)
npm run dev                # development: site on :5173 (hot reload), API on :4000
npm run serve              # production: build the site and serve everything on :4000
```

Open http://localhost:5173 (dev) or http://localhost:4000 (serve). To test a rider and a driver at the same time on one PC, open the second role in an incognito window or at http://127.0.0.1:5173.

| Account | Email | Password |
| --- | --- | --- |
| Customer | customer@demo.com | password |
| Customer | rider2@demo.com | password |
| Driver (Go) | driver@demo.com | password |
| Driver (Comfort) | driver2@demo.com | password |
| Driver (XL) | driver3@demo.com | password |

## Phones and the installable app

See [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md). Short version: `npm run serve`, then `npm run tunnel` for an HTTPS address, open it on each phone and choose "Install app" (Android) or "Add to Home Screen" (iPhone).

## Docker

```bash
docker compose up --build -d      # site + API on http://localhost:4000, demo accounts seeded
```

## Other commands

```bash
npm test                   # backend unit tests (fare engine, ride state machine)
npm run icons              # regenerate PWA icons
npm run docker:logs        # follow container logs
```

## Layout

```
server/   Express API + Socket.IO + SQLite (node:sqlite, no native build)
client/   React + Vite + TypeScript + Leaflet, PWA (manifest + service worker)
docs/     BUILD_REPORT.md, TESTING_GUIDE.md, screenshots/
Dockerfile, docker-compose.yml
```

Rename the product in one place: `client/src/lib/brand.ts` (plus the manifest and `<title>`).

Full details of what was built and why: [docs/BUILD_REPORT.md](docs/BUILD_REPORT.md).

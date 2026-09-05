# SwiftRide — Testing Guide

This guide takes you from zero to testing rides, chat and calls on several phones.

There are two ways to run the product:

| Mode | Command | Use it for |
| --- | --- | --- |
| Development | `npm run dev` | Coding on this PC. Site on port 5173, API on 4000, hot reload. |
| Production build | `npm run serve` | Testing on phones and demos. Everything (site, API, socket, installable app) on **one port, 4000**. |

For phone testing always use the production build. One port means one address to share and one tunnel to open.

---

## 1. First-time setup on this PC

```bash
cd C:\Projects\Ideas\Uber
npm run install:all      # once
npm run seed             # demo accounts, safe to re-run
npm run serve            # builds the web app, then starts on http://localhost:4000
```

Demo accounts (password is `password` for all):

| Role | Email | Vehicle class |
| --- | --- | --- |
| Customer | customer@demo.com | |
| Customer | rider2@demo.com | |
| Driver | driver@demo.com | Go (economy) |
| Driver | driver2@demo.com | Comfort |
| Driver | driver3@demo.com | XL |

You can also create your own accounts from the Sign up page (pick "I want to drive" to make a driver).

Quick check on the PC before touching phones: open http://localhost:4000 in one normal window as the customer and in one incognito window as the driver, book a ride, accept it, complete it.

---

## 2. Getting it onto phones

### Option A: same Wi-Fi, plain HTTP (fastest, some limits)

1. Make sure the phone and the PC are on the same Wi-Fi.
2. On the PC run `npm run serve`.
3. On the phone open `http://<PC-IP>:4000`. Your PC's current Wi-Fi address is **192.168.29.217** (check with `ipconfig` if it changed). If it does not load, allow Node through Windows Firewall (Windows will usually prompt the first time; otherwise Settings → Firewall → Allow an app).
4. Everything works **except** phone GPS and the microphone, because browsers only allow those on HTTPS. Workarounds: the driver switches on "Simulate GPS", and the customer sets pickup by tapping the map or searching. In-app calling will show "Microphone access needs HTTPS" — use Option B for that.

### Option B: HTTPS tunnel (recommended — everything works, and it works off Wi-Fi too)

A tunnel gives your local server a public `https://` address for as long as the command runs.

**Using localtunnel (no install, no account):**

```bash
npm run serve            # terminal 1
npm run tunnel           # terminal 2 → prints e.g. https://tidy-cats-run.loca.lt
```

The first time a phone opens a localtunnel address it shows a "friendly reminder" page asking for a tunnel password. The password is your public IP; get it with:

```bash
curl https://loca.lt/mytunnelpassword
```

Enter it once per phone and you are through.

**Using Cloudflare (no interstitial page, no account):**

```bash
winget install Cloudflare.cloudflared               # once
cloudflared tunnel --url http://localhost:4000      # prints https://something.trycloudflare.com
```

Share the printed address with every tester. With HTTPS, GPS works for the driver, the customer's "use my location" works, and in-app calls work.

### Installing it as an app

Once the site is open on the phone over HTTPS:

- **Android (Chrome):** tap the ⋮ menu → **Install app** (or "Add to Home screen"). Chrome may also show an "Install SwiftRide" banner by itself.
- **iPhone (Safari):** tap the Share button → **Add to Home Screen** → Add.

You now have a SwiftRide icon that opens full screen without browser chrome, like a native app. Install it as the customer on one phone and as the driver on another. It is the same app; the role comes from the account you log in with.

What this is and is not: this is a Progressive Web App. It installs from the browser, updates itself when you redeploy, and needs no app store. It is not an APK/IPA file. Building a store-ready native package (Capacitor wrap or React Native) needs Android Studio / Xcode and is listed under "next steps" in the build report.

---

## 3. Test scenarios

Use two devices: one logged in as a customer, one as a driver. A third device with `driver2@demo.com` is useful for the "who gets the ride" checks.

### 3.1 Accounts

- [ ] Sign up as a new customer. You land on the Ride screen.
- [ ] Sign up as a new driver with vehicle details. You land on the Drive screen, offline.
- [ ] Log out, log in again. You are still the same role.
- [ ] Wrong password shows an error and does not log you in.

### 3.2 Choosing a route and seeing the fare (customer)

- [ ] Type a pickup and pick a suggestion. A teal pin appears.
- [ ] Type a destination and pick one. Routes appear; if more than one, grey lines are alternatives.
- [ ] Tap a grey line or a route card: the black/teal selection moves and the fare changes with the km.
- [ ] Tap "Add a stop / via point", then tap the map. The route bends through the stop and the fare goes up.
- [ ] Drag a pin. The route and fare recompute.
- [ ] Switch between Moto / Go / Comfort / XL. The fare formula line updates.
- [ ] Confirm. Status shows "Finding a driver".

Expected: fare = base + per-km × km + per-min × min + booking fee, never below the minimum fare. The receipt at the end shows exactly these lines.

### 3.3 Ride lifecycle (both devices)

- [ ] Driver goes online. The customer's request appears within a second (no refresh needed), with fare, km, distance to pickup and any stops.
- [ ] A second driver of a different class (e.g. driver2, Comfort) does **not** see a Go request.
- [ ] Driver taps Accept. Customer sees "Driver on the way" with name, car, plate and rating.
- [ ] The driver's car moves on the customer's map (real GPS over HTTPS, or "Simulate GPS").
- [ ] Driver taps "I've arrived" → customer sees "Your driver is here".
- [ ] Driver taps "Start trip" → both see "On trip".
- [ ] Driver taps "Complete trip" → both see the receipt with the same total.
- [ ] Customer rates the driver; driver rates the rider. The driver's star rating updates on their Drive screen.
- [ ] Customer "My trips" and driver "Earnings" show the trip.

### 3.4 Chat

- [ ] After accept, both sides have a "Message" button. Before accept the customer does not.
- [ ] Customer sends a message; the driver sees it appear instantly and the button shows an unread count if the chat panel is closed.
- [ ] Driver replies; customer sees it.
- [ ] Reload a device: the history is still there.
- [ ] After the trip completes, the chat closes.

### 3.5 In-app voice call (needs HTTPS, Option B)

- [ ] Customer taps "Call in app". The phone asks for microphone permission; allow it.
- [ ] Driver's screen shows a green "Incoming call" banner with Answer / Decline.
- [ ] Driver answers. Both banners show "On call" with a running timer. Speak: you hear each other.
- [ ] Mute / Unmute works.
- [ ] Hang up on either side ends it on both.
- [ ] Decline shows "declined the call" on the caller's side.
- [ ] Try calling while the other side is already on a call: caller sees "is on another call".

If audio connects on Wi-Fi but not across mobile data, that is the NAT case that needs a TURN server (see "Known limits").

### 3.6 Phone call fallback

- [ ] The "Phone" button opens the phone dialer with the other party's number (accounts have phone numbers from signup or the seed).

### 3.7 Cancellations and edge cases

- [ ] Customer cancels while "Finding a driver": the request disappears from every driver's list.
- [ ] Driver cancels after accepting: customer sees "Cancelled by driver" and can book again.
- [ ] Two drivers tap Accept at the same time: one gets the ride, the other sees "already taken".
- [ ] A driver with an active ride cannot accept another.
- [ ] A customer with an active ride cannot request another (the Ride screen shows the current one).

### 3.8 Installed app behaviour

- [ ] Open the installed icon: full screen, no address bar.
- [ ] Turn Wi-Fi/data off and open the app: the shell still opens (an error shows for live data, as expected). Turn data back on and it recovers.
- [ ] Kill the app and reopen: you are still logged in.

---

## 4. Docker

Docker is not installed on the build PC, so the image was written but not built here. On any machine with Docker Desktop:

```bash
docker compose up --build -d     # builds the web app, runs API + site on port 4000
docker compose logs -f           # watch it
docker compose down              # stop (data stays in the swiftride-data volume)
```

`SEED_DEMO=1` is on by default in `docker-compose.yml`, so the demo accounts exist on first boot. Set `JWT_SECRET` in a `.env` file next to `docker-compose.yml` for anything beyond local testing. The tunnel commands above work the same against the container (`--port 4000`).

---

## 5. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Phone cannot open `http://<PC-IP>:4000` | Same Wi-Fi? Firewall allowing Node? Try `curl http://<PC-IP>:4000/api/health` from the PC itself. |
| "Location permission denied" on the customer side | Expected on plain HTTP. Use the tunnel, or tap the map to set pickup. |
| Driver's car does not move | Turn on "Simulate GPS" (desktop) or use HTTPS so real GPS is allowed. |
| No route found / "Upstream 429" | The free OSRM or Nominatim server is rate limiting. Wait a minute. For heavy testing self-host OSRM. |
| Address search returns nothing | Nominatim needs at least 3 characters and real place names; results are biased to your map area. |
| Call connects but no audio | Both sides must allow the microphone. On iPhone the installed app must be opened from the icon, not from an in-app browser. Across different networks a TURN server may be needed. |
| "Install app" not offered | It needs HTTPS (tunnel) and a fresh load. On iPhone it is always manual (Share → Add to Home Screen). |
| Old version showing after a redeploy | The service worker caches the shell. Close and reopen the app, or pull-to-refresh. |

---

## 6. Known limits of this version

- Native store packages (APK / IPA) are not produced. The PWA is the multi-device test vehicle.
- In-app calls use a public STUN server only. Most home/office networks work; strict corporate or carrier NATs need a TURN server (coturn or a hosted one), which is a config change in `client/src/components/Comms.tsx`.
- Routing and geocoding use public demo servers with rate limits.
- Payments are recorded, not charged.
- Every online driver in the vehicle class sees every request; there is no radius or offer timeout yet.

# Running and testing SwiftRide

Three questions this answers:

1. How do I test right now, driver on the laptop and rider on my phone?
2. Do I have to start the server by hand every time?
3. Can it run without my laptop at all, for free?

---

## 1. Test right now: driver on laptop, rider on phone

This is the fastest path and needs nothing installed or paid for.

### Step 1 — start the server

Double-click **`start.bat`** in the project folder.

Or from a terminal:

```bash
npm start
```

It installs anything missing, builds the web app the first time, and then prints something like this:

```
  SwiftRide is running

  On this laptop
     http://localhost:4000

  On your phone (same Wi-Fi as this laptop)
     http://192.168.29.217:4000

  In the Android app, put this in the "Server address" box:
     http://192.168.29.217:4000
```

**Leave that window open.** Closing it stops the server.

> The address it prints is worked out by asking Windows which network card actually reaches the internet, so it ignores VirtualBox and VMware adapters that a phone cannot reach.

### Step 2 — be the driver on the laptop

1. Open <http://localhost:4000> in your browser.
2. Log in as **`driver@demo.com`**, password **`password`**, with **"I'm a driver"** selected.
3. Tap **Go online**.
4. Tick **Simulate GPS**. This parks the car in central Delhi and later drives it along the route by itself, which you want because a laptop has no GPS.

### Step 3 — be the rider on the phone

Make sure the phone is on the **same Wi-Fi** as the laptop, then either:

- **Browser:** open the `http://192.168.29.217:4000` address the script printed.
- **App:** open the installed SwiftRide app and put that same address in the **Server address** box on the login screen.

Log in as **`customer@demo.com`**, password **`password`**, with **"I'm a rider"** selected.

### Step 4 — take a ride

1. On the phone, set a pickup **in central Delhi** (type "Connaught Place" and pick it). This matters: the demo drivers are parked there, and a driver is only offered rides within 3 km.
2. Set a destination, choose a route, tap Confirm.
3. Within a second the laptop shows an offer card with a countdown. Tap **Accept**.
4. Watch the car move on the phone.
5. On the laptop tap **I've arrived**, then read the 4-digit PIN off the phone screen, type it on the laptop, and tap **Start trip**.
6. Tap **Complete**. Both sides get the receipt.

### If nothing happens after you book

Almost always one of these:

| Symptom | Cause | Fix |
| --- | --- | --- |
| No offer appears | The driver is offline | Tap Go online |
| No offer appears | Pickup is more than 3 km from the driver | Set the pickup near Connaught Place, or move the driver's simulated position |
| No offer appears | Wrong vehicle class | The rider picked Comfort but only a Go driver is online. Pick **Go**. |
| Phone cannot open the address | Different Wi-Fi | Put both on the same network |
| Phone cannot open the address | Windows Firewall | Allow Node.js through when Windows asks. Otherwise: Windows Security → Firewall → Allow an app → tick Node.js for Private networks |

---

## 2. Stop starting it by hand

### Make it start with Windows

```bash
npm run autostart on
```

That puts a small launcher in your Startup folder. From then on SwiftRide starts by itself, in the background with no window, every time you log in to Windows. Its messages go to `logs/server.log`.

```bash
npm run autostart        # is it on or off?
npm run autostart off    # turn it off again
```

Nothing here needs administrator rights, and you can undo it by hand: press **Win+R**, type `shell:startup`, and delete `SwiftRide.vbs`.

### Stop it

```bash
npm run stop
```

Or double-click `stop.bat`.

### The honest limit

Auto-start solves *"I have to type a command"*. It does **not** solve *"the laptop has to be on"*. While the laptop is asleep or shut down, nothing is reachable. For that you need section 3.

---

## 3. Run it without your laptop, for free

There is no way to run a ride-hailing app with no server at all. Two phones cannot talk to each other without something in the middle holding the accounts, the rides and the matching. What you *can* do is move that something off your laptop.

Below are the genuinely free options, with their real drawbacks. Prices and free tiers change often, so check each provider's own pricing page before relying on it.

### Option A — Render (easiest free, recommended to start)

**What you get:** a permanent `https://swiftride.onrender.com` address that works from anywhere, on any network, with no laptop involved.

**The catches, honestly:**
- It **sleeps after 15 minutes** with no visitors, and takes about a minute to wake up. The first person to open it waits.
- The free plan has **no permanent disk**, so accounts and ride history reset when it restarts. The server notices an empty database and recreates the demo accounts automatically, so you are never locked out, but real test data does not survive.

**Setup, about ten minutes:**

1. Create a free account at [render.com](https://render.com) and connect your GitHub.
2. Click **New +** → **Blueprint**, choose the `uber_clone` repository. Render reads the `render.yaml` already in this project and fills everything in.
3. Click **Apply**. The first build takes a few minutes.
4. When it is live, open the address it gives you. Log in with the demo accounts.
5. In the Android app, put that `https://…onrender.com` address in the **Server address** box.

Because it is HTTPS, real phone GPS, the microphone for in-app calls, and "Add to Home Screen" all work, which they do not over plain HTTP on your Wi-Fi.

### Option B — Fly.io (free-ish, keeps your data)

**What you get:** the same permanent address, plus a real disk so accounts and rides survive restarts, and no sleeping.

**The catches:** it asks for a card even though small usage has historically cost nothing, and setup is a command line rather than a web form. Check their current pricing before you commit.

The project already has `fly.toml`. The commands are in the comments at the top of that file.

### Option C — Oracle Cloud Always Free (best free, hardest setup)

Oracle gives a genuinely free-forever virtual machine that is far more powerful than anything above. It never sleeps and keeps your data.

**The catches:** signup is fussy, needs a card for identity checks, the free machines are sometimes unavailable in a region, and you set up the server yourself. Once running, `npm run docker:up` in the project folder is all it takes.

### Option D — Cloudflare Tunnel over your laptop (free, no account)

Keeps the server on your laptop but gives it a public HTTPS address, so testers do not need your Wi-Fi.

```bash
winget install Cloudflare.cloudflared        # once
cloudflared tunnel --url http://localhost:4000
```

It prints a `https://something.trycloudflare.com` address. **The laptop still has to be on**, and the address changes every time you run it.

### Which one should you pick?

| Your situation | Use |
| --- | --- |
| Testing today, both devices on your Wi-Fi | Nothing new. `start.bat` and section 1. |
| Someone across town needs to try it for an hour | Option D, Cloudflare Tunnel |
| You want a link you can send anyone, any time | **Option A, Render** |
| You want test data to stick around | Option B or C |

---

## 4. Do I need a paid server?

Not yet, and possibly not for a long time.

| Question | Answer |
| --- | --- |
| Does the app cost anything to run? | No. Maps, routing, notifications and the database are all free. |
| Does free hosting cost anything? | No. Render's free plan is genuinely free; it just sleeps. |
| When would I actually need to pay? | When the sleeping becomes annoying to real users, or when you need test data to persist. About ₹400–800 a month buys a small always-on server. |
| Do I need to pay to take payments? | Razorpay costs nothing to open. They keep about 2% of each payment. Until you switch it on, the app uses a built-in test gateway that costs nothing. |

---

## 5. Quick reference

| Command | What it does |
| --- | --- |
| `start.bat` or `npm start` | Start everything and print the phone address |
| `stop.bat` or `npm run stop` | Stop it |
| `npm run autostart on` | Start automatically with Windows |
| `npm run autostart off` | Undo that |
| `npm run serve` | Rebuild the web app, then start |
| `npm run tunnel` | Temporary public address over your laptop |
| `npm run seed` | Recreate the demo accounts |
| `npm test` | Run the 27 automated tests |
| `npm run android:build` | Build a fresh Android app file |

### Demo accounts

Password for all of them is `password`.

| Email | Who |
| --- | --- |
| `customer@demo.com` | Rider, starts with money in the wallet |
| `rider2@demo.com` | A second rider, for testing two riders at once |
| `admin@demo.com` | Rider **and** admin; open `/admin` after logging in |
| `driver@demo.com` | Driver, Go class |
| `driver2@demo.com` | Driver, Comfort class |
| `driver3@demo.com` | Driver, XL class |
| `driver4@demo.com` | Driver, Go class, a second one for testing dispatch |

Inside the app you can copy any email or password with one tap, or copy the whole list at once.

---

For the full feature-by-feature test checklist, see [TESTING_GUIDE.md](TESTING_GUIDE.md).

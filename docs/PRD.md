# SwiftRide — Product Requirements Document

| | |
| --- | --- |
| **Product** | SwiftRide, a ride-hailing service |
| **Version** | 0.3 |
| **Date** | 7 September 2026 |
| **Status** | Working prototype, not launched |
| **Owner** | jashith123 |
| **Repository** | https://github.com/jashith123/uber_clone |

---

## 1. Summary

SwiftRide is a ride-hailing app for riders and drivers. It does what people expect from that category: book a car, watch it arrive, pay, rate.

The one thing it does differently is the reason the product exists. **Every other ride-hailing app decides your route for you and prices it.** SwiftRide shows you the alternatives, lets you add stops, lets you drag the line onto the road you actually want, and then charges you for the kilometres of *that* route. The arithmetic is printed on the screen before you tap Confirm.

---

## 2. The problem

Riders in Indian cities repeatedly report three complaints about existing apps:

1. **The route is chosen for them.** The app sends the driver a route the rider did not pick. Riders who know a faster or safer road cannot express that preference, and arguing with the driver mid-ride is unpleasant.
2. **The price is opaque.** A number appears. Where it came from is not explained. When it changes between two identical trips there is no way to see why.
3. **Surge feels arbitrary.** Prices rise with no visible reason and no indication of when they will fall.

Drivers have their own complaints: they see requests too far away to be worth taking, they are penalised for declining, and their earnings statement does not obviously match the money in their account.

---

## 3. Goals

### Product goals

| # | Goal | How we know it worked |
| --- | --- | --- |
| G1 | The rider chooses the route | A rider can see at least two route options and pick one, and can add via points |
| G2 | The price is explainable | The full formula appears on screen before booking, and again on the receipt |
| G3 | The price follows the chosen route | A longer chosen route costs measurably more than a shorter one for the same trip |
| G4 | Drivers only see reachable rides | No driver is offered a ride further than 10 km from them |
| G5 | Driver earnings are trustworthy | The earnings screen and the wallet balance always agree |
| G6 | Safety is built in, not bolted on | PIN, share-trip link and SOS available on every live ride |

### Non-goals for this version

- Food or parcel delivery.
- Ride pooling (two riders sharing one car).
- Multi-city operations with different tariffs per city.
- Corporate accounts and invoicing.
- Driver rental or leasing programmes.

---

## 4. Users

### 4.1 Rider

**Who:** Anyone needing a point-to-point trip in a city. Owns a smartphone, may be on a slow connection.

**Needs:**
- Get a car quickly.
- Know the price before committing.
- Feel safe, especially at night and alone.
- Not be surprised by the final bill.

**Frustrations we address:** hidden pricing, no say in the route, no way to prove to family where they are.

### 4.2 Driver

**Who:** Owns or rents a vehicle. Drives for income, often part-time. Watches the phone while driving, so decisions must be fast and glanceable.

**Needs:**
- Requests that are actually worth taking, close enough to reach.
- Enough information to decide in a few seconds.
- Clear, honest earnings.
- Protection from riders who cancel after they have already driven over.

**Frustrations we address:** distant requests, penalties they do not understand, earnings that do not match the payout.

### 4.3 Operator (admin)

**Who:** You, or whoever runs the service.

**Needs:**
- See what is happening right now.
- Change prices without a developer.
- Approve or reject drivers.
- Handle emergencies.
- Block bad actors.

---

## 5. Scope

### 5.1 Rider features

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| R-01 | Create an account as a rider, log in, stay logged in for 90 days | Must | Done |
| R-02 | Rider credentials must not open the driver side of the app | Must | Done |
| R-03 | Set a pickup by search, by tapping the map, or from GPS | Must | Done |
| R-04 | See suggested places (recent, popular, landmarks) before typing anything | Should | Done |
| R-05 | Filter those suggestions on every keystroke, from one character | Should | Done |
| R-06 | **See every route option on the map and choose one** | Must | Done |
| R-07 | **Add up to 5 via points that the route must pass through** | Must | Done |
| R-08 | **Drag any pin to change the route** | Should | Done |
| R-09 | See the fare for every vehicle class on the chosen route | Must | Done |
| R-10 | See the fare formula written out before booking | Must | Done |
| R-11 | Apply a promo code and see the discount applied | Should | Done |
| R-12 | See when and why prices are surging | Should | Done |
| R-13 | Choose cash, wallet or card | Must | Done (card needs gateway keys) |
| R-14 | Watch the driver approach with a live road ETA | Must | Done |
| R-15 | Message the driver in the app | Should | Done |
| R-16 | Call the driver without exchanging phone numbers | Should | Done (Wi-Fi and most networks) |
| R-17 | See a PIN that the driver must enter to start the trip | Must | Done |
| R-18 | Share a live tracking link with anyone, no account needed | Should | Done |
| R-19 | Raise an SOS that alerts the operator and shows saved contacts | Must | Done |
| R-20 | Save up to 5 emergency contacts | Should | Done |
| R-21 | Cancel, with the cost shown before confirming | Must | Done |
| R-22 | See a receipt with the full breakdown | Must | Done |
| R-23 | Rate the driver | Must | Done |
| R-24 | See trip history and total spend | Should | Done |
| R-25 | Top up a wallet and see every rupee in and out | Should | Done |
| R-26 | Receive notifications with the app closed | Should | Done |
| R-27 | Verify their phone number by SMS | Must for launch | **Not built** |
| R-28 | Reset a forgotten password | Must for launch | **Not built** |
| R-29 | Book a ride for a future time | Could | **Not built** |

### 5.2 Driver features

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| D-01 | Sign up as a driver with vehicle details | Must | Done |
| D-02 | Upload licence, RC, insurance, permit and photo | Must | Done |
| D-03 | Wait for operator approval before going online, if the operator requires it | Must | Done |
| D-04 | Go online and offline | Must | Done |
| D-05 | **Only be offered rides within reach** | Must | Done |
| D-06 | See fare, pickup distance, route and rider name before accepting | Must | Done |
| D-07 | Have a visible countdown to accept or decline | Must | Done |
| D-08 | Decline without the ride being lost to the rider | Must | Done |
| D-09 | Never be assigned a ride another driver already took | Must | Done |
| D-10 | Enter the rider's PIN to start the trip | Must | Done |
| D-11 | Move the ride through arrived, started and completed | Must | Done |
| D-12 | See earnings that match the wallet exactly | Must | Done |
| D-13 | See commission, penalties and cancellation fees separately | Should | Done |
| D-14 | Request a payout | Should | Done (recorded; transfer is manual) |
| D-15 | Message and call the rider | Should | Done |
| D-16 | Raise an SOS | Must | Done |
| D-17 | See their acceptance rate | Could | Done |
| D-18 | Receive a notification for a new offer with the app closed | Must | Done |
| D-19 | Automatic bank transfer of earnings | Should for launch | **Not built** |
| D-20 | See where demand is highest | Could | **Not built** |

### 5.3 Operator features

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| A-01 | See live counts: rides today, active rides, drivers online, revenue | Must | Done |
| A-02 | Browse and filter every ride | Must | Done |
| A-03 | See the dispatch trail for a ride: who was offered it, who declined | Should | Done |
| A-04 | Search users, block and unblock them | Must | Done |
| A-05 | Adjust any wallet for refunds and goodwill | Should | Done |
| A-06 | Approve or reject drivers with a reason | Must | Done |
| A-07 | **Change any fare without a developer or a restart** | Must | Done |
| A-08 | Create, cap and switch off promo codes | Should | Done |
| A-09 | Draw surge zones and set multipliers | Should | Done |
| A-10 | See and resolve SOS alerts in real time | Must | Done |

---

## 6. Business rules

These are the rules the product runs on. They are enforced by the server, never by the app, so a modified client cannot bypass them.

### 6.1 Pricing

```
distance_charge = per_km  × kilometres × surge
time_charge     = per_min × minutes    × surge
subtotal        = base_fare + distance_charge + time_charge + booking_fee
fare            = max(subtotal, minimum_fare) − promo_discount
```

- **Surge never applies to the base fare or the booking fee.** It only multiplies the distance and time components, capped at ×2.5.
- **The discount comes off after the minimum-fare floor**, so a promo may legitimately take a fare below the minimum.
- **The kilometres are those of the route the rider chose**, not the shortest route.
- The server re-requests the route and recomputes the fare on booking. The client's numbers are never trusted.

Current tariffs (placeholders, editable in the admin panel):

| Class | Base | Per km | Per min | Minimum | Booking fee | Late cancellation |
| --- | --- | --- | --- | --- | --- | --- |
| Moto | ₹15 | ₹6 | ₹0.50 | ₹25 | ₹2 | ₹10 |
| Go | ₹30 | ₹12 | ₹1.00 | ₹50 | ₹5 | ₹30 |
| Comfort | ₹50 | ₹16 | ₹1.50 | ₹80 | ₹8 | ₹40 |
| XL | ₹70 | ₹22 | ₹2.00 | ₹120 | ₹10 | ₹50 |

### 6.2 Surge

Surge is the higher of two numbers, capped at ×2.5:

1. **A zone the operator drew.** A centre, a radius and a multiplier.
2. **Live demand.** Within 5 km of the pickup, if waiting riders outnumber available cars, the multiplier rises by 0.2 for each rider of excess, up to ×2.5.

The rider is always told the reason, for example "3 riders waiting, 1 car nearby".

### 6.3 Matching

A ride is offered in waves. Each wave lasts 20 seconds.

| Wave | Radius | Drivers offered |
| --- | --- | --- |
| 1 | 3 km | 3 nearest |
| 2 | 6 km | 3 more, not already asked |
| 3 | 10 km | 3 more, not already asked |
| After | — | The rider is told nobody is free |

A driver is eligible only if they are online, approved, not blocked, not already on a ride, of the matching vehicle class, and not already holding an open offer. Ties between equally near drivers go to the higher acceptance rate.

### 6.4 Cancellation

| Who cancels | When | Rider pays | Driver receives | Driver pays |
| --- | --- | --- | --- | --- |
| Rider | Still searching | ₹0 | — | — |
| Rider | Within 2 min of acceptance | ₹0 | ₹0 | — |
| Rider | After 2 min, or after the driver arrived | Class fee | Class fee | — |
| Driver | After accepting | ₹0 | — | ₹20 |

When a driver cancels after accepting, the rider is put back into the search immediately rather than being stranded.

### 6.5 Money

- The platform keeps **15%** of each fare (configurable).
- **Wallet and card rides:** the rider is charged, the driver is credited the fare minus commission.
- **Cash rides:** the rider pays the driver directly; the commission is deducted from the driver's wallet.
- Every movement is written to a signed ledger, so the earnings screen and the wallet balance can never disagree.

### 6.6 Safety

- Every ride gets a **4-digit PIN**, shown only to the rider. The server refuses to start the trip without it. The driver is never sent the PIN in any API response.
- Every ride gets a **public share token**. Anyone with the link sees the route, the car's position and the vehicle, but no phone numbers and only the rider's first name.
- **SOS** notifies every operator instantly and returns the user's emergency contacts for a one-tap call.

---

## 7. User journeys

### 7.1 Rider books a ride

1. Opens the app. Already logged in.
2. Taps the pickup box. Recent places, popular places and landmarks appear before typing.
3. Types two letters; the list narrows. Picks one.
4. Types the destination, picks it.
5. Two or three routes appear on the map with prices. Taps the one going the way they prefer.
6. Taps "add a stop" and taps the map at a chemist on the way. The route bends; the price rises.
7. Picks the Go class. The formula is printed underneath.
8. Enters a promo code. The price drops.
9. Chooses cash. Taps Confirm.
10. "Asking 3 nearby drivers…" A driver accepts within seconds.
11. Watches the car approach with minutes remaining.
12. Driver arrives. Rider reads out the 4-digit PIN.
13. Trip runs. Rider shares the tracking link with a family member.
14. Trip ends. Receipt appears. Rider rates 5 stars.

### 7.2 Driver takes a ride

1. Opens the app, taps Go online.
2. An offer card appears with a shrinking timer: ₹222, pickup 0.1 km away, drop-off shown, 14 km trip.
3. Taps Accept with 12 seconds left.
4. Navigates to the pickup. The rider watches them approach.
5. Taps "I've arrived".
6. Asks the rider for the PIN, types it, taps Start trip.
7. Drives the route the rider chose.
8. Taps Complete. Earnings appear in the wallet, net of commission.

### 7.3 Operator handles an emergency

1. An SOS alert appears in the admin panel and as a push notification.
2. Operator sees who raised it, which ride, and the coordinates.
3. Taps to call the person, or opens the location on a map.
4. Marks it resolved.

---

## 8. Success measures

For a pilot, the numbers that would tell us the core idea works:

| Measure | Target | Why it matters |
| --- | --- | --- |
| Rides where the rider changed the default route | > 25% | Proves the differentiator is used, not ignored |
| Rides with at least one via point | > 10% | Proves stops are a real need |
| Offers accepted within the first wave | > 60% | Proves dispatch is picking the right drivers |
| Rider cancellations after acceptance | < 8% | Proves matching and ETAs are honest |
| Driver disputes about earnings | ~0 | Proves the ledger is trusted |
| Median time from request to acceptance | < 45 s | Proves supply and dispatch work together |

---

## 9. Constraints and assumptions

### Constraints

- **Free map services.** Routing and geocoding use public servers that are rate-limited and ask not to be used heavily. This caps traffic at a few hundred rides a day until self-hosted.
- **No payment gateway yet.** Real card and UPI payments need a business account with KYC. Until then only the mock gateway and cash work.
- **Android only.** An iOS build needs a Mac. The project is already structured for it.
- **Single city.** Landmarks and defaults are Delhi NCR. Tariffs are one set, not per city.

### Assumptions

- Riders and drivers both have smartphones with data.
- Cash is an acceptable payment method for the pilot.
- The operator is a person who can respond to an SOS, not an automated system.

---

## 10. Out of scope, with reasons

| Not building | Why not now |
| --- | --- |
| Ride pooling | Needs matching two routes and splitting fares; large amount of work for a feature riders only value at scale |
| Multi-city tariffs | One city first. The schema supports it later. |
| Driver leasing | A financing product, not a software one |
| Food delivery | Different product, different operations |
| In-house maps | Enormous cost; OpenStreetMap is good enough |

---

## 11. Release plan

| Phase | Contents | Gate to move on |
| --- | --- | --- |
| **Now: prototype** | Everything in section 5 marked Done | Two people complete a real ride on real phones |
| **Pilot** | Phone verification, password reset, real tariffs, real payments, a hosted server with a domain | 50 rides completed without an operator intervening |
| **Public** | Play Store listing, rate limiting, Postgres, self-hosted routing, automated payouts | Sustained 100 rides a day |
| **Later** | Scheduling, pooling, iOS, multi-language, referrals | Demand from real users |

---

## 12. Open decisions

These need an answer from the product owner. None of them block current use.

1. **The product name.** "SwiftRide" is a placeholder.
2. **Real tariffs.** Current numbers are invented.
3. **Commission percentage.** Currently 15%.
4. **Cancellation numbers.** Currently 2 minutes free and ₹20 driver penalty.
5. **Driver approval.** Currently automatic. Should new drivers wait for manual approval?
6. **Which city first**, which determines the landmark list and the tariffs.

---

## Related documents

- [LLD.md](LLD.md) — how it is built: schema, APIs, algorithms
- [report.html](report.html) — plain-language status, costs and what is needed from the owner
- [BUILD_REPORT.md](BUILD_REPORT.md) — the build log, phase by phase
- [TESTING_GUIDE.md](TESTING_GUIDE.md) — how to test every feature

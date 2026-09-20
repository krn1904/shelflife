# ShelfLife — build plan

## Context

Karan is building a portfolio project for freelance profiles (Upwork/Fiverr) to demonstrate
full-stack competency. The chosen concept comes from his own workplace: he works at a Melbourne
servo where delivery invoices are passed to the manager manually and **there is no expiry
tracking of any kind**. Stock quietly goes out of date and gets written off.

**ShelfLife** is a multi-tenant back-of-house operations SaaS for convenience retail
(servo-first, sellable to any small-format retailer). MVP scope is deliberately narrow:
**delivery intake + the expiry engine**. Invoice reconciliation, temperature/compliance logs
and fuel wet-stock reconciliation are designed for but not built in v1.

Outcome: a live, demo-able product with four role-scoped portals, an offline-capable phone PWA,
and a case study with real numbers — the hero piece of a freelance profile.

---

## The core product decision: tracking modes

The single most important design choice, and the case-study headline.

Short-life fast movers (milk, bread, sandwiches) are **not** where stock is lost — staff rotate
them daily because they arrive constantly and are front-of-mind. Forcing a scan on every milk
bottle is what kills adoption of expiry apps. The invisible loss is medium/long-life stock at the
back of the store room with a 6–12 month date that nobody ever looks at.

So every product carries one of three modes:

| Mode | Applies to | Intake behaviour | Surfacing |
|---|---|---|---|
| `rotation` | Milk, bread, sandwiches, bakery | No expiry captured | Daily tick-list per fixture ("check dairy fridge") |
| `batch` | Drinks, snacks, chilled cases, grocery | Scan + capture expiry once | Auto-surfaces at T-30/14/7/3/1 |
| `none` | Cigarettes, accessories, phone cards | Quantity only | Never |

Case-study line: *"cut required scanning by ~70% by tracking only what actually goes unnoticed."*

**The wedge:** intake begins with a photo of the supplier docket, stored against the delivery.
This preserves the manager's existing habit (invoices get shared) and upgrades it. It also sets
up invoice reconciliation as v2 and docket OCR as the v3 AI feature.

## Intake is docket-driven, not scan-driven

Scanning every box is redundant — the docket already lists what arrived, and a delivery's
cases overwhelmingly share one expiry date. So intake works *down the docket*:

1. **Pick supplier.** The app pre-populates the expected line list from that supplier's last few
   deliveries to this site (derived from history — no template table to maintain). The first
   delivery from a supplier is manual; every one after is a tick-list.
2. **Confirm what came.** Tick lines, adjust quantity. The field is `qty_received`, pre-filled
   from `qty_docketed`, so any mismatch is a deliberate edit — which is exactly the signal v2's
   reconciliation module consumes.
3. **Confirm the date, don't type it. One date per line, not per box.** The expiry belongs to the
   docket line (the SKU), covering however many boxes of that SKU arrived. Coke Zero 1.5L × 2
   boxes is one line with one date; Coke Zero 2L × 2 boxes is a separate line with its own date.
   Staff never enter a date per box.

   For `batch` items the app *proposes* the expiry from the product's `default_shelf_life_days`,
   or the last date seen for that product from that supplier, so the common action is a tap to
   confirm rather than typing. A one-tap **"same as previous line"** helps when two lines do
   happen to match. A delivery-wide apply exists but is a rare convenience, not the default —
   sibling sizes of the same product routinely carry different dates.
4. **Photo the date panel (optional).** Stored against the batch as evidence for audit and
   supplier disputes. In v3, OCR reads the date off this same photo — an upgrade with zero
   workflow change.

Barcode scanning is retained but repurposed: adding a product to the global catalogue the first
time, and **scan-to-waste** at the shelf, where the item is already in hand and scanning is
genuinely the fastest way to identify it.

---

## Stack

- **Next.js 15** (App Router) + TypeScript strict, Tailwind + shadcn/ui
- **Supabase** — Postgres, Auth, Realtime, Storage (docket photos), Edge Functions (cron jobs)
- **Organisation isolation via RLS** on every table, keyed by `org_id`
- **Barcode scanning:** native `BarcodeDetector` API where available, `@zxing/browser` WASM fallback
- **Offline:** service worker + Dexie (IndexedDB) outbox, client-generated UUIDs, idempotent upserts
- **Notifications:** Web Push (VAPID) via Edge Function + Resend for email digests
- **Charts:** Recharts — load the `dataviz` skill before writing any chart code
- **Deploy:** Vercel + Supabase free tiers, so the demo stays alive indefinitely at zero cost

Deliberately *not* included (per simplicity-first): no ORM beyond `supabase-js`, no event sourcing,
no Redis, no separate job runner, no granular permission matrix.

---

## Step 0 — move out of the scratch workspace

The current working directory is a temporary session workspace that is deleted when the session
ends. Before any code is written, the project must live in a real folder Karan chooses
(e.g. `~/code/shelflife`), via `change_directory`.

---

## Data model

Core tables (all with `org_id`, `created_at`, RLS enabled):

- `orgs` — organisation (a servo or a franchise group), with an active/archived lifecycle
- `sites` — individual store; `org_id`
- `memberships` — `user_id`, `org_id`, `site_id` (nullable = all sites), `role`
- `suppliers` — per-org, seeded with AU names (Metcash, CCA, Lion, PFD, local bread/milk DSD)
- `products` — **global** catalogue keyed by barcode (EAN-13/GTIN): `name`, `brand`, `size`,
  `default_shelf_life_days`, `tracking_mode`, `category`
- `site_products` — per-site overrides: `retail_price`, `par_level`, `fixture`, `active`,
  `tracking_mode_override`
- `deliveries` — `supplier_id`, `site_id`, `docket_number`, `docket_photo_path`,
  `status` (`draft` | `closed`), `received_by`, `received_at`
- `delivery_lines` — `delivery_id`, `product_id`, `qty_docketed`, `qty_received`, `unit_cost`
  (the two quantities are kept separate from day one so v2 reconciliation needs no migration)
- `stock_batches` — the heart: `product_id`, `site_id`, `expiry_date`, `expiry_source`
  (`predicted` | `confirmed` | `manual`), `expiry_photo_path`, `qty_remaining`,
  `delivery_line_id`, `status` (`active` | `pulled` | `sold_through`).
  Normally **one batch per delivery line** — the line's single date covers all its boxes. A line
  is only split into multiple batches in the uncommon case where one SKU arrives carrying two
  different dates; the UI keeps that off the main path.
- `expiry_actions` — generated nightly: `batch_id`, `action` (`check` | `markdown` | `pull`),
  `due_date`, `state` (`open` | `done` | `dismissed`)
- `rotation_checks` — `site_id`, `fixture`, `check_date`, `checked_by`, `state`
- `waste_events` — `batch_id` (nullable), `product_id`, `qty`, `reason_code`, `value_aud`, `by`
- `push_subscriptions`, `audit_log`

**Roles:** `platform_admin` (all organisations), `owner` (multi-site), `manager` (one site),
`staff` (phone only).

**RLS pattern:** a `SECURITY DEFINER` helper `current_user_org_ids()` reading `memberships`,
called from policies — avoids the recursive-policy trap of querying `memberships` inline.
Write a dedicated test that asserts a user from org A cannot read org B's rows.

**Global product catalogue:** scanning an unknown barcode prompts "add this product once" and
writes to the shared `products` table, so every organisation benefits. Per-site overrides never leak.
Platform admin moderates.

---

## The expiry engine

A single Supabase Edge Function on a nightly cron (02:00 Australia/Melbourne):

1. Mark `stock_batches` past `expiry_date` as needing a `pull` action.
2. **Delete and fully regenerate** all `open` `expiry_actions` from current batches.
   No incremental/flag-based diffing — a full recompute over a few thousand rows takes
   milliseconds and is always correct.
3. Create today's `rotation_checks` rows for each site's fixtures.

A second function at 06:00 sends the digest: Web Push to on-shift manager, email to owner.

Both functions return a typed result (`{ processed, skipped, reason }`) written to a
`job_runs` table so failures are legible rather than silent, and the platform-admin portal
can show run history.

---

## Screens

**Staff PWA (phone, offline-capable)**
- Receive delivery: pick supplier → photo docket → tick pre-populated lines and adjust quantity →
  confirm proposed expiry dates (bulk "apply to all selected") → optional date photo → close
- Today's list — check / markdown / pull, grouped by fixture
- Scan to waste — camera scan, quantity + reason code
- Daily rotation checklist
- Add product — scan an unknown barcode, fill it into the global catalogue once

**Manager (tablet/desktop)**
- Site dashboard: expiring counts, waste $ this month, open deliveries, live activity feed (Realtime)
- Deliveries list + detail with docket photo
- Expiry board — columns by days remaining, colour-coded
- Waste log + reason-code breakdown
- Products, par levels, tracking modes
- Users

**Owner (desktop)**
- Multi-site rollup, waste % league table by site, trend charts, CSV export

**Platform admin**
- Create an organisation with its first site and owner; archive/restore organisations
- Global catalogue moderation and `job_runs` history
- Archival blocks organisation members and pauses jobs/notifications without deleting records

---

## Offline sync

Right-sized, not event-sourced:

- Every mutation from the PWA is queued in a Dexie `outbox` table with a client-generated UUID
  used as the row's primary key.
- On reconnect, replay in order as idempotent upserts — a replayed write is a no-op.
- Conflicts on scalar fields resolve last-write-wins; quantity changes are recorded as separate
  `waste_events` / `delivery_lines` rows rather than in-place decrements, so no write is lost.
- UI shows a persistent "N changes pending" indicator; a failed sync surfaces its reason.

---

## Build phases (~6 weeks part-time)

1. **Week 1** — Repo, Supabase project, schema + RLS + seed script, auth, org/site/membership,
   role-based routing shell. Gate: cross-organisation isolation test passes.
2. **Week 2** — Product catalogue, `site_products`, barcode scanning component with fallback
   (used for catalogue-add and scan-to-waste), unknown-barcode add flow.
3. **Week 3** — Docket-driven intake end to end: supplier history → expected lines, qty
   confirmation, expiry prediction + bulk apply, docket and date photos to Storage,
   `stock_batches` creation.
4. **Week 4** — Expiry engine cron, `expiry_actions`, Today's list, rotation checklist,
   waste capture with reason codes.
5. **Week 5** — Web Push + email digest, manager dashboard, expiry board, waste analytics,
   owner multi-site rollup, platform admin.
6. **Week 6** — PWA offline outbox, seed a realistic demo organisation (3 sites, 8 months of history),
   demo logins, polish, deploy.

---

## Demo & presentation (do not skip — this is what converts)

- Live URL with **four one-click demo logins**, one per role, no signup
- Seeded demo org: 3 Melbourne sites, ~400 products, 8 months of delivery and waste history so
  charts look real
- **A "jump 7 days forward" button in demo mode** so a visitor can watch the expiry engine fire
  without waiting — the single best trick in the whole demo
- 90-second narrated screen recording: problem → scan → alert fires → owner sees the dollars
- Case-study page: the real problem at his workplace, the tracking-mode decision and why,
  architecture diagram, three trade-offs, and metrics
- Map to an Upwork Project Catalog listing: *"Multi-tenant inventory & expiry SaaS with mobile PWA"*

---

## Verification

- `tsc --noEmit`, `next build`, and `eslint` must all exit 0 before any phase is called done
- **RLS test suite** — a script that signs in as org A and asserts every table returns zero
  org B rows. This is the security claim the whole product rests on; it gets a real test.
- Expiry engine tested by seeding batches at known offsets and asserting the exact
  `expiry_actions` generated
- Offline path tested with DevTools offline mode: queue 5 scans, reconnect, assert 5 rows and
  no duplicates on a forced double-replay
- Barcode scanning verified on a real Android phone against real product barcodes — the
  desktop simulator is not proof
- Intake timed against a real docket at Karan's site: target is a repeat supplier delivery
  closed in under 60 seconds. If it isn't, the prediction/bulk-apply flow needs work — this is
  the number the whole product's adoption rests on.
- Push notifications verified end to end on a real device; note explicitly that iOS requires
  the PWA to be installed to the home screen

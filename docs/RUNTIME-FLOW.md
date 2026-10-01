# ShelfLife — runtime flow

How the app works end-to-end, one line per step. For the code-level map see
[ARCHITECTURE.md](ARCHITECTURE.md); for the product rationale see [PRODUCT.md](PRODUCT.md).

1. **Sign in** — user hits `/login`; `getSession()` revalidates via `auth.getUser()` and loads their memberships → routed to their portal (`/app`, `/manage`, `/owner`, `/admin`).
2. **Every request** — the proxy refreshes the auth cookie; every DB query runs as that user, so Postgres RLS enforces organisation/site isolation.
3. **Receive a delivery** — staff photograph the docket to Storage and tap **Read docket** (Textract or the on-device reader); the supplier is recognised from its ABN, a remembered docket name, or its letterhead name (`identifySupplier()`), then confirmed or added. With no docket, staff pick a supplier and `expectedLines()` pre-fills the tick-list from its past dockets.
4. **Confirm lines** — the list is the docket's product rows (`parseReading()`), linked to catalogue products only when certain and otherwise trusted as printed (new products on close); tick what arrived and adjust `qty_received` against the docket's `qty_docketed`.
5. **Confirm dates** — `proposeExpiry()` suggests one date per SKU line (from observed supplier shelf life, else catalogue default); staff tap to confirm → one `stock_batch` per line.
6. **Nightly 02:00 (expiry-engine)** — auth via `x-cron-secret`, read active batches, read each site's `reminder_settings`, `planExpiryActions()` gives each batch at most one reminder from its shelf-life group (fixed on arrival) and what staff already answered, delete-and-regenerate all `open` `expiry_actions`, upsert today's rotation checks through organisation-locked RPCs that skip archives → write a `job_runs` row.
7. **Morning 06:00 (daily-digest)** — build each site's summary, recheck the organisation is still active, Web Push to on-shift devices whose subscription belongs to that organisation + email the owner (nothing outstanding → nothing sent).
8. **Act on the list** — staff answer "Today" in one tap: Check → *Checked*; Half price → *Reduced price* / *Gone*; Last day → *Pulled out* (how many binned) / *Sold*, via `resolve_batch_step()`. They also tick rotation fixtures.
9. **Record waste** — *Pulled out* writes expired waste automatically (site cost, else the docket's unit price); Scan to waste covers damaged, spoiled or recalled stock with qty + reason code.
10. **Offline** — Today answers that cannot be sent are kept in the Dexie outbox under the same UUID idempotency key and replayed oldest-first on reconnect (intake is *not* queued).
11. **Managers/owners view** — delivery review (`/manage/deliveries`: open deliveries, docketed vs received, the docket photo and reading), expiry board, waste analytics, multi-site rollup, CSV export — all reading RLS-scoped data.
12. **Admin operates the platform** — creates organisations with their first site and owner, manages members and temporary password resets, archives/restores organisations, and monitors catalogue and `job_runs` health. Archived organisations retain their records but lose member access, jobs and notifications.

## The four portals

| Route | Role | Purpose |
|---|---|---|
| `/app` | staff | The phone PWA — receive deliveries, today's list, scan-to-waste, rotation checks |
| `/manage` | manager | One site — delivery review, expiry board, waste log, product/par settings, reminder settings |
| `/owner` | owner | Multi-site rollup, waste league table, trend charts, CSV export |
| `/admin` | platform_admin | All organisations — lifecycle, catalogue moderation, `job_runs` history |

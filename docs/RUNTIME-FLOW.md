# ShelfLife — runtime flow

How the app works end-to-end, one line per step. For the code-level map see
[ARCHITECTURE.md](ARCHITECTURE.md); for the product rationale see [PRODUCT.md](PRODUCT.md).

1. **Sign in** — user hits `/login`; `getSession()` revalidates via `auth.getUser()` and loads their memberships → routed to their portal (`/app`, `/manage`, `/owner`, `/admin`).
2. **Every request** — the proxy refreshes the auth cookie; every DB query runs as that user, so Postgres RLS enforces organisation/site isolation.
3. **Receive a delivery** — staff pick a supplier; `expectedLines()` pre-fills the tick-list from that supplier's past dockets (no template table).
4. **Confirm lines** — tick what arrived, adjust `qty_received`; photograph the docket to Storage.
5. **Confirm dates** — `proposeExpiry()` suggests one date per SKU line (from observed supplier shelf life, else catalogue default); staff tap to confirm → one `stock_batch` per line.
6. **Nightly 02:00 (expiry-engine)** — auth via `x-cron-secret`, read active batches, `planExpiryActions()` assigns one action per batch on the T-30/14/7/3/1 ladder, delete-and-regenerate all `open` `expiry_actions`, upsert today's rotation checks through organisation-locked RPCs that skip archives → write a `job_runs` row.
7. **Morning 06:00 (daily-digest)** — build each site's summary, recheck the organisation is still active, Web Push to on-shift devices whose subscription belongs to that organisation + email the owner (nothing outstanding → nothing sent).
8. **Act on the list** — staff work "Today" (check / mark down / pull) and tick rotation fixtures.
9. **Record waste** — scan-to-waste with qty + reason code; unit cost turns it into dollars written off.
10. **Offline** — waste/tick writes queue in the Dexie outbox with a UUID idempotency key, replayed oldest-first on reconnect (intake is *not* queued).
11. **Managers/owners view** — expiry board, waste analytics, multi-site rollup, CSV export — all reading RLS-scoped data.
12. **Admin operates the platform** — creates organisations with their first site and owner, manages members and temporary password resets, archives/restores organisations, and monitors catalogue and `job_runs` health. Archived organisations retain their records but lose member access, jobs and notifications.

## The four portals

| Route | Role | Purpose |
|---|---|---|
| `/app` | staff | The phone PWA — receive deliveries, today's list, scan-to-waste, rotation checks |
| `/manage` | manager | One site — expiry board, waste log, product/par settings, users |
| `/owner` | owner | Multi-site rollup, waste league table, trend charts, CSV export |
| `/admin` | platform_admin | All organisations — lifecycle, catalogue moderation, `job_runs` history |

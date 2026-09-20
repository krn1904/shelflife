# ShelfLife

Back-of-house operations for convenience retail. Track what arrives, know what expires, stop
writing off stock nobody noticed.

Built servo-first for the Australian market, generalisable to any small-format retailer.

## The problem

Small-format retail loses money to expiry in a place nobody looks. Short-life stock — milk,
bread, sandwiches — is rotated daily because it arrives constantly and is front-of-mind.
The invisible loss is medium and long-life stock sitting at the back of the store room with a
6–12 month date that no one checks until it is months gone.

## The approach

Every product carries one of three tracking modes, so staff only do work that pays for itself:

| Mode | Applies to | At intake | Surfacing |
|---|---|---|---|
| `rotation` | Milk, bread, sandwiches, bakery | Nothing captured | Daily fixture tick-list |
| `batch` | Drinks, snacks, chilled, grocery | One expiry per line | Auto-surfaces at T-30/14/7/3/1 |
| `none` | Cigarettes, accessories | Quantity only | Never |

Intake is **docket-driven, not scan-driven**. The docket already lists what arrived, so the app
pre-populates expected lines from that supplier's history; staff tick what came, adjust quantity,
and confirm a proposed expiry date — one date per SKU line, covering every box of that SKU.

## Status

In development. MVP scope is delivery intake plus the expiry engine. Invoice reconciliation,
temperature/compliance logging and fuel wet-stock reconciliation are designed for but not built.

See [docs/PLAN.md](docs/PLAN.md) for the full build plan, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a developer's map of the codebase.
Platform operations are documented in
[docs/PLATFORM-ADMIN.md](docs/PLATFORM-ADMIN.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Supabase (Postgres, Auth,
Realtime, Storage, Edge Functions) · Postgres RLS for organisation isolation

## Local development

Requires Node 22 (see `.nvmrc`), the Supabase CLI, and Docker.

```bash
nvm use
npm install
supabase start          # local Postgres/Auth/Storage on ports 544xx
npm run seed            # two organisations, so isolation is testable
npm run dev
```

`supabase start` prints the local URL and keys for `.env.local`. The project uses the
544xx port range rather than Supabase's 543xx defaults, so it can run alongside another
local Supabase project.

### Verification

```bash
npm test                # pure logic — barcode check digits, tracking-mode resolution
npm run test:rls        # cross-organisation isolation must pass before anything ships
npx tsc --noEmit
npm run build
```

`npm test` needs no database. `npm run test:rls` needs a running Supabase and a seeded
database, and is the gate that matters — it is the security claim the product rests on.

### The expiry engine

`supabase/functions/expiry-engine` runs nightly at 02:00 Australia/Melbourne. It deletes
every open `expiry_actions` row and regenerates them from the current batches — a full
recompute over a few thousand rows takes milliseconds and is always correct, so there is
no incremental diffing to get wrong. It also creates the day's rotation checks.

The function is a thin wrapper. Every rule it applies lives in `src/lib/expiry/engine.ts`
as plain TypeScript covered by `npm test`, so the logic is testable even though the
function itself only runs under Deno.

```bash
supabase functions deploy expiry-engine
supabase secrets set CRON_SECRET=...      # required; the function 403s without it
```

Trigger it by hand to watch it work:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/expiry-engine" -H "x-cron-secret: $CRON_SECRET"
```

Every run writes a row to `job_runs`, successful or not — a cron that has silently
stopped firing is the failure mode that costs the most, because nothing looks broken
until the stock is already gone. The platform-admin portal says so in as many words
when the engine has not reported in for 36 hours.

### The morning digest

`supabase/functions/daily-digest` runs at 06:00 and pushes each site's list to whoever
has notifications on for that site. A day with nothing outstanding sends nothing — a
daily "all clear" is how people learn to swipe the notification away unread.

```bash
supabase functions deploy daily-digest
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

Push is per device, not per account: the store tablet and a manager's own phone are
separate switches, under **Shift → Notifications**. On iPhone the PWA must be added to
the home screen first — Safari only allows push for installed apps.

### Offline

Shelf-side mutations — writing off stock and ticking an action — are queued in an
IndexedDB outbox and replayed in order when the connection returns. Every queued write
carries a client-generated id the server treats as an idempotency key, because a request
that timed out may or may not have been applied: the only safe design is to retry it and
make retrying harmless. A persistent strip shows what is still on the device, and says
why when something cannot be sent rather than dropping it.

Intake is deliberately **not** queued. It is a multi-step flow whose draft lives on the
server, and pretending otherwise would be a bigger promise than this outbox can keep.

### The demo organisation

```bash
npm run seed:demo       # 3 sites, ~400 products, 8 months of history
```

Deterministic: a seeded PRNG, so a rebuild produces the same numbers and a screenshot in
the case study keeps matching the live site. Set `NEXT_PUBLIC_DEMO_MODE=true` on the
public deployment to enable the four one-click role logins and the **jump 7 days**
button, which moves the demo organisation's dates so a visitor can watch the expiry engine fire
without waiting a week. The engine is never told it is a demo — only the data moves —
and `demo_jump_days()` refuses outright on any org not flagged `is_demo`.

Leave `NEXT_PUBLIC_DEMO_MODE` unset anywhere real.

### Organisation administration

The platform-admin portal creates each organisation with its first site and owner account.
Archiving an organisation preserves its users and operational history while blocking member
access and pausing expiry processing and notifications. Platform admins can continue to inspect
and restore it. The UI never permanently deletes an organisation.

## Deploying

Vercel for the app, Supabase for everything else, both on free tiers.

```bash
supabase link --project-ref <ref>
supabase db push                     # migrations
supabase functions deploy expiry-engine
supabase functions deploy daily-digest
supabase secrets set CRON_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
```

Vercel needs `NEXT_PUBLIC_SUPABASE_URL`, the anon/publishable key, the service/secret
key, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Supabase renamed its keys in 2025 and both
naming schemes are accepted — `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY` — so use whichever pair your project's API settings show. Schedule both Edge
Functions (02:00 and 06:00 Australia/Melbourne), passing `x-cron-secret`.

After deploying, regenerate the database types against the live schema:

```bash
supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

Seed logins (all share the password printed by `npm run seed`):

| Email | Role | Sees |
|---|---|---|
| `owner@northside.test` | owner | all three Northside sites |
| `manager@northside.test` | manager | Brunswick |
| `staff@northside.test` | staff | Brunswick |
| `owner@bayside.test` | owner | St Kilda (separate organisation) |

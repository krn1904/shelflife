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

See [docs/PLAN.md](docs/PLAN.md) for the full build plan.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Supabase (Postgres, Auth,
Realtime, Storage, Edge Functions) · Postgres RLS for tenant isolation

## Local development

Requires Node 22 (see `.nvmrc`), the Supabase CLI, and Docker.

```bash
nvm use
npm install
supabase start          # local Postgres/Auth/Storage on ports 544xx
npm run seed            # two orgs, so tenant isolation is testable
npm run dev
```

`supabase start` prints the local URL and keys for `.env.local`. The project uses the
544xx port range rather than Supabase's 543xx defaults, so it can run alongside another
local Supabase project.

### Verification

```bash
npm test                # pure logic — barcode check digits, tracking-mode resolution
npm run test:rls        # cross-tenant isolation must pass before anything ships
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

Seed logins (all share the password printed by `npm run seed`):

| Email | Role | Sees |
|---|---|---|
| `owner@northside.test` | owner | all three Northside sites |
| `manager@northside.test` | manager | Brunswick |
| `staff@northside.test` | staff | Brunswick |
| `owner@bayside.test` | owner | St Kilda (separate tenant) |

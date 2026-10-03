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
| `batch` | Drinks, snacks, chilled, grocery | One expiry per line | Half price, then a last-day call (long-life also gets an early check) |
| `none` | Cigarettes, accessories | Quantity only | Never |

Intake is **docket-driven, not scan-driven**. The docket already lists what arrived, so staff
photograph it and the app reads it: the supplier is recognised from the docket (its ABN, or a
name it has printed before) and the line list is the docket's product rows, linked to the
catalogue where that is certain and otherwise taken as printed, as new items to double-check
that become the organisation's own products (other organisations never see them).
Staff check each line against the paper, adjust quantity, and confirm a proposed expiry date — one date per SKU
line, covering every box of that SKU. Docketed and received quantities are kept apart, so a
short delivery is on record. With no docket to read, the list is predicted from that supplier's
recent deliveries instead.

## Status

In development. MVP scope is delivery intake plus the expiry engine. Invoice reconciliation,
temperature/compliance logging and fuel wet-stock reconciliation are designed for but not built.

See [docs/PLAN.md](docs/PLAN.md) for the full build plan, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a developer's map of the codebase.
Platform operations are documented in
[docs/PLATFORM-ADMIN.md](docs/PLATFORM-ADMIN.md), and agreed-but-unscheduled work is in
[docs/BACKLOG.md](docs/BACKLOG.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Supabase (Postgres, Auth,
Realtime, Storage, Edge Functions) · Postgres RLS for organisation isolation

## Local development

Requires Node 22 (see `.nvmrc`), the Supabase CLI, and Docker.

Local and hosted Supabase are set up the same way — migrations first, then one seed
command — and the only difference is which project `.env.local` points at:

| Step | Local | Hosted |
|---|---|---|
| Database | `supabase start` (ports 544xx) | `supabase link --project-ref <ref>` |
| Schema | `supabase migration up` | `supabase db push` |
| Data | `npm run db:reset` | `npm run db:reset` |
| `.env.local` | URL and keys printed by `supabase start` | the project's API settings |

```bash
nvm use
npm install
supabase start && supabase migration up
npm run db:reset        # wipe and write the full seed world (see "The seed world")
npm run dev
```

The project uses the 544xx port range rather than Supabase's 543xx defaults, so it can run
alongside another local Supabase project. `supabase db reset` applies migrations only; the
SQL seed hook is off so there is exactly one seed, and it behaves the same everywhere.
Scheduled Edge Functions exist only on the hosted project; locally their history in
`job_runs` comes from the seed.

### Verification

```bash
npm test                # pure logic — barcodes, tracking modes, docket reading, intake rules
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
no incremental diffing to get wrong. It also creates the day's rotation checks. Both writes
lock each organisation and skip any that have been archived since the job's snapshot.

Reminders follow each batch's **shelf life on arrival** (expiry date minus the day it came
in), fixed once so long-life stock keeps its long-life reminders to the end:

| Group (defaults) | Reminders |
|---|---|
| Short-life, up to 21 days | Half price 2 days before → last day |
| Medium-life, up to 90 days | Half price 7 days before → last day |
| Long-life, longer | Early check 30 days before → half price 7 days before → last day |

Each site can change these under **Site → Reminder settings**; a site that never does uses
the defaults. Staff answer each card in one tap — *Reduced price* or *Gone*, then on the last
day *Pulled out* or *Sold* — and a batch moves on to its next reminder instead of repeating.
*Pulled out* records the leftover as expired waste automatically, valued at the site's unit
cost or, failing that, the price read off the docket.

The **expiry board** shows the same cards as columns (Last day, Half price, Check, On half
price, Coming up) and takes the same answers. Staff open it from Today; managers under
**Site → Expiry board**.

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
has notifications on for that organisation and site. Delivery is cancelled if the
organisation is no longer active. A day with nothing outstanding sends nothing — a
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

Answers on the Today list are sent straight away, or kept in an IndexedDB outbox when
there is no signal and replayed in order when the connection returns. Every queued write
carries a client-generated id the server treats as an idempotency key, because a request
that timed out may or may not have been applied: the only safe design is to retry it and
make retrying harmless. A persistent strip shows what is still on the device, and says
why when something cannot be sent rather than dropping it.

Intake is deliberately **not** queued. It is a multi-step flow whose draft lives on the
server, and pretending otherwise would be a bigger promise than this outbox can keep.

### Reading dockets

**Receive a delivery** offers two readers. The free one runs Tesseract in the browser and needs
nothing set up. AWS Textract reads printed tables column by column and is billed per photo (one
`AnalyzeDocument` call on the intake screen; the **Test docket OCR** bench makes a second,
invoice-model call to compare them). Textract needs an IAM key allowed to call it:

```bash
TEXTRACT_ACCESS_KEY_ID=...
TEXTRACT_SECRET_ACCESS_KEY=...
TEXTRACT_REGION=ap-southeast-2   # default
```

Without them the Textract option shows as not set up and the free reader is used. The
`TEXTRACT_*` names come first because Vercel reserves `AWS_*` for its own identity.

### The demo organisation

The demo organisation is part of the seed world written by `npm run db:reset` (3 sites,
~300 products, 8 months of history). Set `NEXT_PUBLIC_DEMO_MODE=true` on the
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
key, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and the `TEXTRACT_*` keys if docket reading should offer
AWS Textract. Supabase renamed its keys in 2025 and both
naming schemes are accepted — `NEXT_PUBLIC_SUPABASE_ANON_KEY` or
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY` — so use whichever pair your project's API settings show. Schedule both Edge
Functions (02:00 and 06:00 Australia/Melbourne), passing `x-cron-secret`.

After deploying, regenerate the database types against the live schema:

```bash
supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

## The seed world

```bash
npm run db:reset                 # wipe everything, then write the seed world
npm run db:reset -- --dry-run    # print what would be written, touch nothing
```

One command puts the database back into a known, complete state. It **deletes every
organisation, auth user, catalogue product, job run, audit entry and docket photo** —
including anything created through the UI or by `npm run test:rls` — then writes the
world defined in [scripts/seed-world.ts](scripts/seed-world.ts). Run it whenever the data
has drifted or gone stale. It refuses to run against a database that is behind on
migrations; apply them first with `supabase db push`.

Every date is relative to the day you run it (Melbourne time), so a fresh reset always has
stock overdue, expiring today, this week and next month, today's fixture list half ticked,
and a delivery still being counted in. The PRNG is seeded, so the same day produces the
same data. `npm test` checks the world's invariants without a database.

| Organisation | State | What it shows |
|---|---|---|
| BP Melbourne North (Demo) (`bp-melbourne-north-demo`) | active, `is_demo` | 3 sites, 8 months of deliveries, stock and waste; expired write-offs build up, then fall sharply once the site starts acting on the list (~3 months ago) |
| Metro Petroleum (`metro-petroleum`) | active | 3 sites, 6 months of history, the RLS suite's org A, role change and password-reset audit trail |
| United Petroleum (`united-petroleum`) | active | 1 site, 3 months, a smaller range; archived and restored once (audit trail); the RLS suite's org B |
| Liberty Oil (`liberty-oil`) | **archived** 18 days ago | Archived list and Restore; its members are locked out |
| Ampol Eastern (`ampol-eastern`) | active, new | Onboarded 2 days ago: every empty state, a removable site |

Across them: every reminder card (stock already on half price, long-life checks answered),
the demo's Coburg site with its own reminder settings, every waste reason (including a supplier recall), short deliveries
(`qty_received` < `qty_docketed`), site tracking-mode overrides, ranged-off lines, an
inactive supplier, a supplier with no history yet (the manual-entry intake path),
products added by staff scans, suppliers with ABNs (all but Local Bakehouse, the no-ABN case), done/dismissed action history, three weeks of rotation
checks, and three weeks of `expiry-engine` / `daily-digest` runs including one failure.
No push subscriptions are seeded — those belong to real devices.

| Email | Password | Role | Sees |
|---|---|---|---|
| `staff@demo.shelflife.app` | `shelflife-demo` | staff | Demo · Brunswick |
| `manager@demo.shelflife.app` | `shelflife-demo` | manager | Demo · Brunswick |
| `owner@demo.shelflife.app` | `shelflife-demo` | owner | all three demo sites |
| `admin@demo.shelflife.app` | `shelflife-demo` | platform admin | every organisation |
| `coburg.manager@demo.shelflife.app`, `coburg.staff@…`, `preston.staff@…` | `shelflife-demo` | manager / staff | their demo site |
| `admin@shelflife.test` | `shelflife-dev-password` | platform admin | every organisation |
| `owner@metro-petroleum.test` | `shelflife-dev-password` | owner | all three Metro Petroleum sites |
| `manager@metro-petroleum.test` / `staff@metro-petroleum.test` | `shelflife-dev-password` | manager / staff | Metro Petroleum · Brunswick |
| `coburg.manager@metro-petroleum.test` / `preston.staff@metro-petroleum.test` | `shelflife-dev-password` | manager / staff | their Metro Petroleum site |
| `owner@united-petroleum.test` / `staff@united-petroleum.test` | `shelflife-dev-password` | owner / staff | St Kilda (separate organisation) |
| `owner@liberty-oil.test` / `manager@liberty-oil.test` | `shelflife-dev-password` | owner / manager | nothing — organisation archived |
| `owner@ampol-eastern.test` | `shelflife-dev-password` | owner | Ringwood (empty) |

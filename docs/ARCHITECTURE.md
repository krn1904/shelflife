# ShelfLife — architecture

A developer's map of the codebase: how the pieces fit, where each responsibility lives, and
the few patterns worth understanding before changing anything. For *what* the product does and
*why*, read [PRODUCT.md](PRODUCT.md); for the original build plan, [PLAN.md](PLAN.md).

---

## Shape of the system

```
Browser / PWA ──▶ Next.js (App Router)         Supabase
                  ├─ Server Components ─────────▶ Postgres (RLS per request)
                  ├─ Server Actions / Routes ──▶ Postgres (RLS per request)
                  └─ Client Components            Auth   (cookie session)
                       │                          Storage (docket / date photos)
                       └─ Dexie outbox            Realtime
                                                  Edge Functions (cron)
                                                  ├─ expiry-engine  02:00
                                                  └─ daily-digest   06:00
```

Everything server-side runs **as the signed-in user**, so Postgres Row-Level Security is the
real access-control boundary. The two Edge Functions are the only code that uses the service
key and bypasses RLS; they run on a cron, not in a request.

---

## Directory layout

```
src/
  app/                         Next.js App Router
    (portal)/                  authenticated shell; layout gates the session
      app/                       staff PWA  — deliveries, today, scan, waste, settings
      manage/                    manager    — delivery review, expiry board, waste, products
      owner/                     owner      — multi-site rollup + CSV export route
      admin/                     platform admin — organisations, lifecycle, job history
    login/                     one public route (+ demo one-click logins)
  components/                  shared UI (portal shell, charts, scanner, toggles)
  lib/
    supabase/                  client factories, env resolution, generated types
    auth/                      session resolution + role gates, sign-in actions
    intake/                    docket-driven receiving: docket reading, supplier recognition,
                               expected lines, expiry proposal
    expiry/                    the engine's rules (re-exported from _shared), digest text
    offline/                   Dexie outbox + framework-free queue semantics
    products/                  tracking-mode resolution, product mutations
    analytics/                 waste/rollup aggregation for the dashboards
    barcode/                   GTIN check digits, BarcodeDetector + zxing reader
    demo/                      demo-mode config and the "jump N days" action
  proxy.ts                     session refresh on every request (Next 16 "Proxy")

supabase/
  migrations/                  schema, RLS helpers, policies, lifecycle and intake changes (in order)
  functions/
    _shared/                   engine + digest + tracking logic (single source of truth)
    expiry-engine/             thin Deno wrapper, nightly
    daily-digest/              thin Deno wrapper, morning
scripts/                       seed-world (data) + reset-db (npm run db:reset), test-rls
```

---

## Request path and the Supabase clients

There are three ways to reach Postgres, and picking the wrong one is the easiest mistake to
make here:

| Factory | File | Runs as | Use for |
|---|---|---|---|
| `createClient()` | [server.ts](../src/lib/supabase/server.ts) | the signed-in user (RLS) | Server Components, Server Actions, Route Handlers — almost everything |
| browser client | [client.ts](../src/lib/supabase/client.ts) | the signed-in user (RLS) | Client Components (Realtime, interactive reads) |
| admin client | [admin.ts](../src/lib/supabase/admin.ts) | service key (**bypasses RLS**) | Edge Functions and platform-admin paths only |

Credentials are resolved once in [env.ts](../src/lib/supabase/env.ts), which accepts both the
pre-2025 (`ANON` / `SERVICE_ROLE`) and post-2025 (`PUBLISHABLE` / `SECRET`) Supabase key names
and fails loudly, naming the variable to set, rather than constructing a client around an empty
string.

[proxy.ts](../src/proxy.ts) (Next 16's renamed Middleware) refreshes the auth cookie on every
matched request so Server Components always see a live token. It does **no** authorization — the
comment says so explicitly. That is why `createClient()`'s cookie `setAll` swallows the throw it
gets inside a Server Component: only the proxy, actions, and route handlers may write cookies.

---

## Auth, session, and role gating

All of it is in [session.ts](../src/lib/auth/session.ts).

- `getSession()` calls `supabase.auth.getUser()` (revalidates against the auth server) rather
  than `getSession()` (trusts the cookie). It then loads the user's memberships, sites, and
  profile.
- **The load-bearing filter:** memberships are queried with `.eq('user_id', user.id)`. RLS
  scopes `memberships` to the *org*, not the user, so without that explicit filter `primaryRole`
  would become the highest role held by *anyone* in the org — silently handing staff the owner
  and admin portals. This is called out in a comment and is worth preserving.
- `requireSession()` bounces to `/login`; `requireRole(bar)` bounces a too-low role to *its own*
  portal (via `homePathFor`) rather than erroring.
- `activeSite(session, requestedId?)` resolves which site an action targets. Because
  `session.sites` is already RLS-scoped, a caller cannot widen its scope by passing another org's
  site id — an unknown id simply falls through to the user's pinned site.

The `(portal)` [layout](<../src/app/(portal)/layout.tsx>) calls `requireSession()` once and wraps
everything in `PortalShell`. Individual portal roots call `requireRole(...)` for their bar.

Every portal has a `loading.tsx` (a `PageSkeleton` from
[loading-skeleton.tsx](../src/components/loading-skeleton.tsx)), so navigation shows the next
screen's outline at once while its server data loads. The session read stays in the shared
`(portal)` layout, which is not re-rendered when moving between portal pages, so it does not
block those fallbacks. `PortalNav` ignores a second tap on a tab that is loading or already
open, and form buttons that call a Server Action directly use `SubmitButton`, which disables
itself while the action runs.

---

## Row-Level Security (the security boundary)

The core tables, helper, policy and organisation-lifecycle migrations build it in order.

The helpers in [rls_helpers.sql](../supabase/migrations/20260905000002_rls_helpers.sql) are the
foundation every policy is written against:

- `is_platform_admin()`, `auth_org_ids()`, `auth_site_ids()`, `has_org_role(org, roles[])`, and
  the intent-named wrappers `can_manage_org()` / `can_manage_site()`.
- Each is **`SECURITY DEFINER` with `search_path = ''`**. The definer bypass is not an
  optimisation: the helpers read `memberships`, which is itself RLS-protected, so a policy that
  queried it inline would re-enter its own policy and recurse forever. The empty `search_path`
  (hence fully-qualified `public.*` names everywhere) defeats search-path hijacking.
- A membership with a **null `site_id` grants every site in the org**; a non-null one pins to
  that site. `auth_site_ids()` encodes this.

`npm run test:rls` ([test-rls.ts](../scripts/test-rls.ts)) signs in as org A and asserts every
table returns zero org-B rows. It needs a running, seeded Supabase and is the gate the whole
product rests on — treat a failure here as a release blocker, not a flaky test.

---

## Organisation lifecycle

`orgs.status` is `active` or `archived`. Platform admins provision an organisation together with
its first site and owner, then manage it at `/admin/organisations/[orgId]`. The complete operator
workflow is documented in [PLATFORM-ADMIN.md](PLATFORM-ADMIN.md).

Archival is deliberately reversible: operational rows and auth users remain intact, while
`auth_org_ids()`, `auth_site_ids()` and role checks stop returning access for organisation
members. `is_platform_admin()` remains independent of organisation status so the platform can
inspect and restore archived organisations. The service-role Edge Functions bypass RLS, so both
the expiry engine and daily digest explicitly query active organisation IDs, then recheck that
status at write/dispatch time: expiry actions and rotation checks go through RPCs that lock each
organisation and skip archived rows, and the digest cancels delivery if an organisation is no
longer active. Site-scoped push delivery also requires the subscription's `org_id` to match the
site. Owners can still insert and update sites and memberships in their own organisation; those
policies are owner-scoped, so platform admins cannot use them to bypass the audited RPCs.
Normal application users have no `DELETE` policy on `orgs`; permanent deletion is break-glass
maintenance, not a UI operation.

---

## The "one copy of the logic" pattern

Edge Functions run under Deno and the Supabase bundler will not follow an import out into the
app source. So the pure rules live in **`supabase/functions/_shared/`** (`engine.ts`,
`digest.ts`, `tracking.ts`), and the app re-exports them:

```ts
// src/lib/expiry/engine.ts
export * from '../../../supabase/functions/_shared/engine';
```

The result: one implementation, imported as `@/lib/expiry/engine` by app code and tests, and by
relative path from the Deno function. The `*.test.ts` files exercise it under Node without Deno
or a database in sight. When you touch engine or digest rules, edit the `_shared` copy.

---

## The expiry engine

Rules: [_shared/engine.ts](../supabase/functions/_shared/engine.ts). Wrapper:
[expiry-engine/index.ts](../supabase/functions/expiry-engine/index.ts).

- `planExpiryActions(batches, today)` emits **exactly one action per batch** — the most urgent
  tier on the T-30/14/7/3/1 ladder it currently qualifies for (already-expired ⇒ always `pull`).
  Not one row per threshold crossed. This pairs with a partial unique index on `(batch_id) where
  state = 'open'`.
- `planRotationChecks(fixtures, today)` emits one check per fixture per site per day.
- The wrapper is thin: authenticate the cron call (`x-cron-secret`, else 403), scope to active
  organisations, read active batches, **delete their `open` `expiry_actions` and re-insert** through
  RPCs that lock each organisation and skip any that have been archived since the snapshot (full recompute — correct by
  construction, no incremental diffing to get wrong; done/dismissed rows are history and stay),
  then upsert rotation checks the same way (`ignoreDuplicates`, so a same-day re-run never wipes staff ticks).
- "Today" is computed in `Australia/Melbourne`, not UTC — a 02:00 Melbourne run is still
  yesterday in UTC and the whole ladder would shift by a day.
- **Every run writes a `job_runs` row, success or failure.** A silently-stopped cron is the
  worst failure mode (nothing looks broken until stock is gone); the admin portal flags an engine
  that has not reported in 36 hours.

The 06:00 [daily-digest](../supabase/functions/daily-digest/index.ts) shares the same shape:
authenticate, scope to active organisations, build per-site summary text via `_shared/digest.ts`,
Web Push to live subscriptions whose `org_id` matches the site (pruning 404/410 dead ones), and
cancel delivery if the organisation is no longer active at dispatch time. Email the owner. A site
with nothing outstanding sends nothing. Organisation-wide (null `site_id`) subscriptions are
restricted to owners and platform admins.

---

## Docket-driven intake

The receiving flow lives under `app/deliveries/` with its logic in [src/lib/intake/](../src/lib/intake).
It starts at the docket, not a supplier list:

1. **Photo before the delivery exists.** [receive-delivery.tsx](<../src/app/(portal)/app/deliveries/new/receive-delivery.tsx>)
   picks the delivery's UUID in the browser and uploads a resized JPEG to
   `dockets/{org}/{site}/{deliveryId}/docket.jpg`. The storage policies only check the org and
   site folders, and `startDelivery` accepts the photo only at exactly that path.
2. **Two readers, one shape.** Both produce a `DocketReading`
   ([reading.ts](../src/lib/intake/docket/reading.ts)): every text line, plus the chosen product
   table cell by cell when there is one. AWS Textract runs server-side from the stored photo
   (`readDocketWithTextract`, one `AnalyzeDocument` TABLES call; the test bench also runs the
   invoice model). The free reader is Tesseract in the browser
   ([browser.ts](../src/lib/intake/docket/browser.ts)). Which engine a plan gets is meant to be
   decided later; nothing downstream depends on it.
3. **Supplier from the docket.** `identifySupplier()` ([supplier.ts](../src/lib/intake/docket/supplier.ts))
   looks only at the letterhead (text above the first product-shaped line): a valid ABN on file
   (mod-89 checked in [abn.ts](../src/lib/intake/docket/abn.ts), so a misread digit cannot match),
   then a remembered alias, then the supplier's own name. A partial name is only a suggestion.
   Staff create suppliers through the `add_supplier()` RPC, which returns the existing supplier
   for a known ABN or name instead of duplicating it; `suppliers_insert` still limits direct
   writes to managers. Starting the delivery calls `remember_supplier_docket()`, which saves the
   printed name as an alias and fills in a missing ABN.
4. **Lines from the reading.** The rules below live in [plan.ts](../src/lib/intake/plan.ts), free of the
   database and the browser, and are covered by `plan.test.ts`. The delivery keeps the reading in `deliveries.docket_reading`, and
   `docketLines()` parses it on every render: `parseDocketTable()` reads Textract's grid by column
   heading (an empty Delivered cell stays empty), `parseDocket()` handles plain text. Every row
   becomes a line. It is linked to a catalogue product only when that is beyond doubt: a barcode,
   or a name match of 0.85 or better (`LINKED_AT`), where a different size or a near-spelling
   alone never counts. Otherwise the OCR is trusted: the line keeps the name the docket prints
   (`printedProductName()`), a weaker match is only offered as a suggestion, and two rows are
   never folded into one product. There is no per-supplier product-code table; that is left
   for if OCR proves unreliable. With no reading, `expectedLines()` predicts the list as before.
5. **Docketed vs received.** `closeDelivery` stores the docket's figure in `qty_docketed` and the
   count in `qty_received`, keeping a line with 0 received (it did not arrive) and creating
   batches only for what arrived. Without a docket reading the two are equal, as before. Lines
   still unlinked become products **private to the organisation** (`products.org_id`) under their
   docket name (a visible product with exactly that name is reused), so the next docket printing
   it links outright. Other organisations never see them; the shared catalogue (`org_id` null)
   is unchanged. Rows that turn
   out to be one product are added into one `delivery_line`, keeping a batch per row.

- `expectedLines(history)` ([expected-lines.ts](../src/lib/intake/expected-lines.ts)) builds the
  pre-populated tick-list from what this supplier actually sent to this site before — so there is
  **no delivery-template table** to maintain. History arrives newest-first; lines are ranked by
  how often a product appears (reliable weekly lines float up, one-offs sink).
- `proposeExpiry(...)` ([expiry.ts](../src/lib/intake/expiry.ts)) proposes a date so staff
  *confirm* rather than *type*. It uses the supplier's **observed shelf life** (last expiry minus
  last arrival), not the stale previous date, and discards implausible history (<1 or >3650 days)
  in favour of the catalogue default. When it has nothing, it returns `source: 'manual'` and a
  null date so a typed date is never mistaken for one the system stood behind.

One expiry per SKU line, covering every box of that SKU ⇒ normally one `stock_batch` per
`delivery_line`.

---

## Offline sync

Only shelf-side mutations — **waste and action-state ticks** — are queued. Intake is
deliberately *not* (its draft lives on the server; a multi-step flow is a bigger promise than the
outbox can keep). Split in two on purpose:

- [queue.ts](../src/lib/offline/queue.ts) — framework-free semantics, fully unit-tested:
  `classifyFailure` (retry transient, give up on permanent or after `MAX_ATTEMPTS` = 8),
  `backoffMs` (exponential, capped at 5 min), `replayOrder` (oldest-first).
- [outbox.ts](../src/lib/offline/outbox.ts) — the Dexie/IndexedDB store and `drain(send)`, which
  **replays in order and stops at the first entry needing retry** rather than skipping ahead
  (a later write-off can depend on an earlier one decrementing the batch).

Every entry carries a client-generated UUID (`crypto.randomUUID()`) used as an **idempotency
key**: a request whose outcome was never learned is safe to retry because the server treats a
replay as a no-op. `PendingChanges` surfaces what is still on the device and why anything is
stuck.

---

## Demo mode

Config shared between the seed and the login buttons lives in
[src/lib/demo/config.ts](../src/lib/demo/config.ts) (`DEMO_ORG_SLUG`, public `DEMO_PASSWORD`, the
four `DEMO_LOGINS`) so the two can never offer a login that was never seeded.

`NEXT_PUBLIC_DEMO_MODE=true` enables the one-click logins and the **jump-N-days** button. The
jump moves only the demo organisation's dates so a visitor can watch the engine fire; the engine is
never told it is a demo, and `demo_jump_days()` refuses on any org not flagged `is_demo`. Leave
the flag unset anywhere real.

---

## Data model

17 tables, all with `org_id` + RLS, created across the migrations. The schema calls a customer
organisation an `org`; “tenant” appears only where describing the standard multi-tenant
architecture:

`orgs`, `sites`, `profiles`, `memberships`, `suppliers` (optional ABN, unique per organisation),
`supplier_aliases` (docket names confirmed for a supplier), `products` (the shared catalogue keyed by
barcode, plus each organisation's own products added from dockets, which carry `org_id`),
`site_products` (per-site overrides incl. `tracking_mode_override`), `deliveries`,
`delivery_lines` (`qty_docketed` vs `qty_received` kept separate from day one — this is what
makes v2 reconciliation need no migration), `stock_batches`, `expiry_actions`, `rotation_checks`,
`waste_events`, `job_runs`, `push_subscriptions`, `audit_log`.

`memberships` is `unique nulls not distinct (user_id, org_id, site_id)`. Organisation-wide
roles (owner, platform admin) store `site_id = null`, and a plain unique constraint lets NULLs
repeat, so those rows could be duplicated and `onConflict: 'user_id,org_id,site_id'` upserts
never matched them.

Tracking mode is resolved from the catalogue default plus the optional per-site override via
`effectiveTrackingMode(...)` in `products/tracking.ts` — the engine uses the same function so app
and cron agree on what counts as `rotation`.

---

## Testing & verification

| Command | Needs a DB? | Covers |
|---|---|---|
| `npm test` | no | pure logic — GTIN check digits, tracking resolution, expiry ladder, digest text, intake proposal, outbox queue, docket parsing (incl. the real Bega table), supplier recognition, intake rules (`plan.ts`: linking, closing, screen payload) |
| `npm run test:rls` | **yes** (seeded) | cross-organisation isolation — the release gate |
| `npx tsc --noEmit` | no | strict types |
| `npm run build` | no | production build |

The design rule throughout: keep decisions in plain, DB-free functions so they can be tested,
and keep the things that touch Postgres or Deno as thin wrappers around them.

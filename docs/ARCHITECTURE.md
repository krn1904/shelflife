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
                       └─ Dexie outbox            Edge Function (cron)
                                                  └─ expiry-engine  03:00 (pg_cron)
```

Everything server-side runs **as the signed-in user**, so Postgres Row-Level Security is the
real access-control boundary. Only the expiry-engine Edge Function (on a cron) and a few server-only paths
— platform-admin actions and adding people, which must create logins — use the service key
and bypass RLS, and those authorise the caller first.

---

## Directory layout

```
src/
  app/                         Next.js App Router
    (portal)/                  authenticated shell; layout gates the session
      app/                       staff PWA  — deliveries, today, expiry board, scan, waste, messages, settings
      manage/                    manager    — delivery review, expiry board, waste, products, reminder settings, messages, people
      owner/                     owner      — multi-site rollup + CSV export route
      admin/                     platform admin — organisations, lifecycle, job history
    login/                     one public route (+ demo one-click logins)
  components/                  shared UI (portal shell, staff tabs, theme picker, charts, scanner)
  lib/
    supabase/                  client factories, env resolution, generated types
    auth/                      session resolution + role gates, sign-in actions
    intake/                    docket-driven receiving: docket reading, supplier recognition,
                               expected lines, expiry proposal
    expiry/                    the engine's rules (re-exported from _shared), reminder text,
                               Today wording, board columns + the board's windowed loader
    messages/                  manager → staff site messages: validation, read summaries, loaders, actions
    people/                    owner/manager staff management: who may manage whom (rules.ts), actions, loader
    offline/                   Dexie outbox + framework-free queue semantics
    products/                  tracking-mode resolution, product mutations
    analytics/                 waste/rollup aggregation for the dashboards
    barcode/                   GTIN check digits, BarcodeDetector + zxing reader
    demo/                      demo-mode config and the "jump N days" action
    theme/                     light/dark choice: cookie parsing + the server-side read
  proxy.ts                     session refresh on every request (Next 16 "Proxy")

supabase/
  migrations/                  schema, RLS helpers, policies, lifecycle and intake changes (in order)
  functions/
    _shared/                   engine + tracking logic (single source of truth)
    expiry-engine/             thin Deno wrapper, nightly
scripts/                       seed-world (data) + reset-db (npm run db:reset), test-rls
```

---

## Request path and the Supabase clients

There are three ways to reach Postgres, and picking the wrong one is the easiest mistake to
make here:

| Factory | File | Runs as | Use for |
|---|---|---|---|
| `createClient()` | [server.ts](../src/lib/supabase/server.ts) | the signed-in user (RLS) | Server Components, Server Actions, Route Handlers — almost everything |
| browser client | [client.ts](../src/lib/supabase/client.ts) | the signed-in user (RLS) | Client Components (interactive reads) |
| admin client | [admin.ts](../src/lib/supabase/admin.ts) | service key (**bypasses RLS**) | Server-only: platform-admin actions, and adding or listing people (`src/lib/people`), which need logins created or read |

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
inspect and restore archived organisations. The service-role expiry engine bypasses RLS, so it
explicitly queries active organisation IDs, then rechecks that status at write time: expiry
actions and rotation checks go through RPCs that lock each organisation and skip archived rows.
Owners can still insert and update sites and memberships in their own organisation; those
policies are owner-scoped, so platform admins cannot use them to bypass the audited RPCs.
Normal application users have no `DELETE` policy on `orgs`; permanent deletion is break-glass
maintenance, not a UI operation.

---

## The "one copy of the logic" pattern

Edge Functions run under Deno and the Supabase bundler will not follow an import out into the
app source. So the pure rules live in **`supabase/functions/_shared/`** (`engine.ts`,
`tracking.ts`), and the app re-exports them:

```ts
// src/lib/expiry/engine.ts
export * from '../../../supabase/functions/_shared/engine';
```

The result: one implementation, imported as `@/lib/expiry/engine` by app code and tests, and by
relative path from the Deno function. The `*.test.ts` files exercise it under Node without Deno
or a database in sight. When you touch engine rules, edit the `_shared` copy.

---

## The expiry engine

Rules: [_shared/engine.ts](../supabase/functions/_shared/engine.ts). Wrapper:
[expiry-engine/index.ts](../supabase/functions/expiry-engine/index.ts).

- `planExpiryActions(batches, today, settingsBySite)` emits **at most one action per batch**. The
  batch's group (`shelfLifeGroup()`: short / medium / long) is fixed by its shelf life on arrival —
  expiry minus the Melbourne date of `stock_batches.created_at`, which is when its delivery closed —
  so it never drifts into a shorter group as the date nears. Then: expiry day or past ⇒ `pull`
  (shown as *Last day*); within the group's half-price days and not yet `marked_down_at` ⇒
  `markdown`; long-life within the early-check days and not yet `checked_at` ⇒ `check`. A
  marked-down batch waits for its last day. This pairs with a partial unique index on
  `(batch_id) where state = 'open'`.
- Per-site settings come from `reminder_settings` (`settingsFromRow()`); a site without a row uses
  `DEFAULT_REMINDER_SETTINGS`, the same defaults as the table's columns. `validateReminderSettings()`
  holds the same rules as the table's checks (no reminder may fire the day the shortest item of
  its group arrives) and drives the settings screen.
- The Today list and the expiry board share one card and answer hook
  ([reminder-card.tsx](../src/components/reminder-card.tsx)). The board
  ([board.ts](../src/lib/expiry/board.ts), loaded by `loadBoard()` in
  [board-data.ts](../src/lib/expiry/board-data.ts)) adds two look-ahead columns, *On half price*
  and *Coming up* (within the site's early-check days), to the three reminder columns.
- Staff answer through `resolve_batch_step(batch, step, qty, client_id)`: `checked` and
  `marked_down` stamp the batch, `sold` closes it as `sold_through`, `pulled` writes the binned
  quantity as `expired` waste (valued by `batch_unit_cost()`: site cost, else the docket line's
  `unit_cost`) and closes it as `pulled`. It closes the batch's open action, is idempotent for
  offline replay, and runs as the caller so RLS applies.
- `planRotationChecks(fixtures, today)` emits one check per fixture per site per day.
- The wrapper is thin: authenticate the cron call (`x-cron-secret`, else 403), scope to active
  organisations, read active batches, **delete their `open` `expiry_actions` and re-insert** through
  RPCs that lock each organisation and skip any that have been archived since the snapshot (full recompute — correct by
  construction, no incremental diffing to get wrong; done/dismissed rows are history and stay),
  then upsert rotation checks the same way (`ignoreDuplicates`, so a same-day re-run never wipes staff ticks).
- **Every date is on the site's own calendar.** Each site has a required timezone
  (`sites.timezone`, chosen from [timezones.ts](../src/lib/sites/timezones.ts); the database
  refuses a missing or unknown zone). The app's `todayIn(site.timeZone)` and the jobs'
  `planPerSite()` work out "today" and a batch's arrival day per site, never from the server's
  clock: the app runs on UTC servers, where a Melbourne morning is still yesterday.
- **Every run writes a `job_runs` row, success or failure.** A silently-stopped cron is the
  worst failure mode (nothing looks broken until stock is gone); the admin portal flags an engine
  that has not reported in 36 hours.

**Owners and managers manage their own people** ([src/lib/people/](../src/lib/people)). Adding a
person needs the service key (only it can create a login), so `addSiteMember()` authorises first,
in app code (the site is in the caller's RLS-scoped `session.sites`, the role passes
`canManageRole()`), and only then calls `auth.admin.createUser`. `add_site_member()`, security
definer, is the authority: it re-checks the role with `can_manage_site_role()` (owner or platform
admin: staff or manager at any site of the organisation; manager: staff at the site they manage),
locks the organisation and requires it active, refuses a login with a membership in another
organisation, and writes the `member.added` audit row itself (`write_audit` only accepts
`platform_admin.*`). If it refuses, the just-created login is deleted. `remove_site_member()`
applies the same rule, never to the caller's own membership or an organisation-wide one, and
leaves the login. The People list reads memberships as the user (RLS) and looks up emails with
the service key only for those ids.

**Reminders are in-app, per account.** There is no morning job and no Web Push. The staff and
manager home screens read what is due today through `loadReminders()`
([reminders-data.ts](../src/lib/expiry/reminders-data.ts)): the same site (`activeSite`), the
site's own date and the same filters as the Today page, so the banner, the Today-tab count and
the list agree. It returns nothing for owners and platform admins (`remindersShownTo()`) before
querying, and is cached per request so the portal layout's badge and the page's banner share one
read. Wording and colour come from `summariseReminders()`
([reminders.ts](../src/lib/expiry/reminders.ts)). The badge lives in the portal layout; answers go
through Server Actions that call `revalidatePath`, which re-renders the current route including
the layout, so the count drops without a reload. The pop-up
([reminder-toast.tsx](../src/components/reminder-toast.tsx)) is remembered in localStorage per
account and site and the site's date, written only when the person taps Open or Later. Because an open tab never re-renders on its
own, [refresh-on-return.tsx](../src/components/refresh-on-return.tsx) calls `router.refresh()`
when the tab becomes visible after at least a minute hidden (`refreshOnReturn()`), or is
restored from the back/forward cache. It notes a timestamp on hide rather than running a
timer, so an idle, visible tab does no work.

**Site messages** ([src/lib/messages/](../src/lib/messages)) use the same delivery: no push, no
polling, no realtime subscription. A manager inserts a `site_messages` row for their site; staff
acknowledge with a `site_message_reads` row (primary key `(message_id, user_id)`, written with
`ignoreDuplicates` so a double tap needs no update permission). Staff get only messages sent since
their membership at the site was created (`memberships.created_at`, `sentSince()`), and
`readSummary()` leaves later joiners out of each message's count. `loadStaffMessages()` is cached per
request on plain ids, so the portal layout (unread notes above every staff page,
[message-notices.tsx](../src/components/message-notices.tsx)) and the Shift and Messages pages
share one read. The actions call `refresh()` from `next/cache`, which re-renders the layout too,
so a note leaves the screen as soon as it is acknowledged. Notes render inline at the top of the
page, never floating, so they don't cover the reminder pop-up or the bottom tabs. RLS: everyone at
the site reads messages; only `can_manage_site` at that site inserts (as themselves, `sent_by =
auth.uid()`) or deletes; there is no update. A reader sees only their own read rows; the site's
manager or owner sees all of them. `require_active_org_write` stops an archived organisation
sending.

---

## UI and theming

The look is the "Night shift" design system, documented in [DESIGN.md](DESIGN.md).

- **Tokens, not colours.** Every colour is a CSS variable in
  [globals.css](../src/app/globals.css), mapped to Tailwind utilities (`bg-surface`,
  `text-muted`, `border-line`, `bg-brand`…). Components never use raw palette classes such as
  `neutral-500` or `red-50`, so both themes come from the same markup.
- **Light and dark.** With no `theme` cookie, CSS follows `prefers-color-scheme`. The
  `ThemePicker` writes the cookie and flips `data-theme` on `<html>`; the root layout reads the
  cookie through [theme/server.ts](../src/lib/theme/server.ts), so the server's first paint
  already matches. Every route reads the session cookie anyway, so this makes no page
  dynamic that wasn't already.
- **Charts** follow the theme through `.chart` CSS rules, which override the colours Recharts
  writes as SVG attributes. The one series colour is validated for both surfaces in
  [charts/tokens.ts](../src/lib/charts/tokens.ts).
- **Staff navigation** is `BottomTabs` on a phone and the same `SHIFT_TABS` in the header from
  `sm` up. The list lives in a plain module ([shift-tabs.ts](../src/components/shift-tabs.ts))
  because the server-rendered shell cannot read data exported from a `'use client'` file.

### Recent activity and Refresh

The manager home's feed is read on the server like the rest of the page:
[feed-data.ts](../src/lib/activity/feed-data.ts) reads the site's last 7 days from four tables
(closed `deliveries`, `waste_events`, done `expiry_actions`, done `rotation_checks`), at most 25
of each, then `buildFeed()` ([feed.ts](../src/lib/activity/feed.ts), tested) merges them newest
first and keeps 15. A last-day answer that binned stock is left out because its waste row already
says it, with the quantity. Actor names come from one `profiles` query.

Nothing is pushed or polled. `RefreshButton` ([refresh-button.tsx](../src/components/refresh-button.tsx))
calls `router.refresh()` inside a transition, which re-renders the page's server components
and keeps client state. The manager home and `/admin` use it. `RefreshOnReturn` still re-reads
the page when someone comes back to the tab.

Admin pages show times with `platformTime()` ([time.ts](../src/lib/admin/time.ts)), on
Melbourne's clock. They used the server's default, which is UTC on Vercel, so the 03:00 engine
run read as 4:00 pm the day before.

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
   (`readDocketWithTextract`, one `AnalyzeDocument` TABLES call). The free reader is Tesseract in the browser
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

The screen walks the lines **one at a time** by default, with "Show all lines" for the full
list. Both views render the same component state; the cursor maths (clamping, "Line n of N",
the last line) is in [walk.ts](../src/lib/intake/walk.ts) and tested.

---

### Manager corrections

A closed delivery is corrected by a manager, never re-opened: re-running `closeDelivery` would
rewrite batches staff have since acted on. Two `SECURITY DEFINER` functions in
[delivery_corrections.sql](../supabase/migrations/20261006000001_delivery_corrections.sql) do the
writes, so each is one transaction with its own audit row:

- `can_correct_site(site)` is the permission: an owner of the site's organisation, or a manager
  whose membership covers that site. It is stricter than `can_manage_site(org)`, which a manager
  pinned to another site of the same organisation would pass.
- `correct_delivery_line(line, qty_docketed, qty_received, batches)` takes the line's dated
  stock as it should be. A listed batch is updated, a new one is inserted with the delivery's
  close time as `created_at` (the engine counts shelf life from it), and one left out is deleted.
  Dates may cover less than arrived. On an `active` batch `qty_remaining` moves by the change in
  `qty_received`, and the function refuses to drop it below what has already left (written off
  or sold). A `pulled` or `sold_through` batch stays at 0 remaining: staff cleared that shelf, so
  a higher count must not raise a reminder for stock already gone. A changed date becomes
  `expiry_source = 'manual'` and the batch's open reminder is deleted for the next run to plan.
  The first correction copies staff's figures into `staff_qty_*`. A product no longer tracked
  by date keeps its closed-out batches untouched, and a line with stock that already left the
  shelf cannot be removed.
- `review_docket_product(...)` edits a product with `org_id` set (never the shared catalogue) and
  stamps `reviewed_at`. Rotation requires a fixture, upserted into `site_products`. Tracking
  belongs to the product, so a change of mode covers every site that receives it: it is refused
  if any of those sites is not one the caller runs (a site-pinned manager asks an owner), and
  rotation is refused until each of them has a fixture. Leaving `batch` deletes the product's
  untouched active batches and closes the rest as `sold_through`, because the engine plans
  reminders for every active dated batch whatever the product's tracking mode.
- Both lock the organisation row and refuse an archived one, as `add_site_member` does.

The form rules (`LineCorrection`, `checkCorrection`, `ProductReview`) are in
[corrections.ts](../src/lib/deliveries/corrections.ts); the database repeats the ones it can
check and adds those only it can see. `audit_log` is readable by owners, so the delivery page
shows the correction from the line itself.

## Offline sync

Only shelf-side mutations are queued: today that is **answers on the Today list**
(`batch-step`, sent through [send.ts](../src/lib/offline/send.ts), which tries the server first and
queues under the same id when there is no signal). Fixture ticks are sent
directly. Intake is
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
stuck. It syncs on `online`, on a 20 s poll and once on mount; overlapping calls are dropped by
[single-flight.ts](../src/lib/offline/single-flight.ts), which keeps the "running" flag out of
React state. (Keeping it in state once made the strip's effect reinstall itself on every flip
and drain IndexedDB thousands of times a second on every portal page.)

---

## Demo mode

Config shared between the seed and the login buttons lives in
[src/lib/demo/config.ts](../src/lib/demo/config.ts) (`DEMO_ORG_SLUG`, public `DEMO_PASSWORD`, the
four `DEMO_LOGINS`) so the two can never offer a login that was never seeded.

`NEXT_PUBLIC_DEMO_MODE=true` enables the one-click staff, manager and owner logins (never the
platform admin) and the **jump-N-days** button. The
jump moves only the demo organisation's dates so a visitor can watch the engine fire; the engine is
never told it is a demo, and `demo_jump_days()` refuses on any org not flagged `is_demo`. Leave
the flag unset anywhere real.

---

## Data model

18 tables, all with `org_id` + RLS, created across the migrations. The schema calls a customer
organisation an `org`; “tenant” appears only where describing the standard multi-tenant
architecture:

`orgs`, `sites`, `profiles`, `memberships`, `suppliers` (optional ABN, unique per organisation),
`supplier_aliases` (docket names confirmed for a supplier), `products` (the shared catalogue keyed by
barcode, plus each organisation's own products added from dockets, which carry `org_id` and
stay on the review list until `reviewed_at` is set),
`site_products` (per-site overrides incl. `tracking_mode_override`), `deliveries`,
`delivery_lines` (`qty_docketed` vs `qty_received` kept separate from day one — this is what
makes v2 reconciliation need no migration; `unit_cost` is the unit price read off the docket when
the reader is certain of it; `staff_qty_*` / `corrected_*` record a manager's correction), `stock_batches` (`checked_at` / `marked_down_at` record staff
answers), `reminder_settings` (one row per site that changed the defaults), `expiry_actions`, `rotation_checks`,
`waste_events`, `job_runs`, `audit_log`, `site_messages` and `site_message_reads` (manager notes to
staff and who has read them). (`push_subscriptions` was dropped in
`20261005000001` when reminders moved in-app.)

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
| `npm test` | no | pure logic — GTIN check digits, tracking resolution, reminder plans and settings, Today card wording, expiry board columns, reminder text and who sees it, site message validation and read summaries, who may add or remove whom, intake proposal, outbox queue and sync single-flight, barcode camera release on stop, docket parsing (incl. the real Bega table and unit prices), OCR contrast range, supplier recognition, intake rules (`plan.ts`: linking, closing, screen payload, docket unit cost), line-by-line intake navigation (`walk.ts`), theme cookie parsing |
| `npm run test:rls` | **yes** (seeded) | cross-organisation isolation — the release gate |
| `npx tsc --noEmit` | no | strict types |
| `npm run build` | no | production build |

The design rule throughout: keep decisions in plain, DB-free functions so they can be tested,
and keep the things that touch Postgres or Deno as thin wrappers around them.

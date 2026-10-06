# ShelfLife — backlog

Work that has been agreed but not scheduled. Each item records what was asked for and what
is already known, so it can be picked up without re-deriving the context.

---

## Site messages: replies, and staff who move sites

**Built (2026-10-05):** a manager's note to everyone on staff at a site, acknowledged with Got it,
with *Read by N of M* on the manager's side. Chosen deliberately as one-way. Staff see only
messages sent since they joined the site (Karan: a new starter must not inherit a year of notes).

Not done:

- **Replies.** A thread per message (staff answer, manager answers back) was considered and left
  out. It would need a `site_message_replies` table with the same site-scoped RLS, and a way for
  the manager to notice a reply, since nothing is pushed.
- **Staff moved to another site.** "Joined" is `memberships.created_at`, and moving someone
  (`update_organisation_member`) changes the row's `site_id` in place, so the date stays when
  they first joined the organisation. A moved staff member therefore sees the new site's
  messages back to that date (at most the last 50). Fixing it needs a `site_joined_at` column
  set whenever `site_id` changes.

---

## Supplier overview for managers

**Asked for:** a detailed manager screen, built with the manager portal work, not a bare
supplier list.

- Every supplier with what they have delivered: deliveries per site, lines and quantities
  that operators marked as received, and when.
- Docketed against received quantities, so short deliveries per supplier are visible.
- Supplier upkeep: rename, deactivate, and merge duplicates (moving deliveries and aliases
  onto the surviving supplier).
- Review suppliers that staff created during intake, since staff can add one from a docket.

**Partly done (2026-10-06):** Site → Deliveries lists deliveries by supplier and date with
docketed against received quantities, so a supplier's short deliveries show up (filter by the
supplier). Site → Deliveries → Suppliers renames, switches off and (owners) merges duplicates,
keeping old names recognised on dockets, and shows each supplier's delivery count and last
delivery. Still open: a per-supplier summary page (short-delivery rate, lines over time).

**Already in place:** suppliers carry an optional ABN and a list of printed-name aliases,
which intake uses to recognise a supplier from its docket
([docs/ARCHITECTURE.md](ARCHITECTURE.md), docket-driven intake).

---

## Why the app is slow

**Reported:** the app feels slow. Switching screens (Shift to Group) was tapped twice because
nothing showed the tap had registered, which fetched the page twice.

**Done (2026-09-28):** every portal has a `loading.tsx` skeleton, so a tap shows the next
screen's outline at once; the portal tabs show a pending state and ignore a second tap on a
tab that is loading or already open; the admin Update/Remove and Sign out buttons disable while
their action runs (`SubmitButton`). This fixes the feedback, not the speed itself.

**Still to do:** find the actual cause. Measure the slowest pages' queries before optimising:
several pages page through whole tables (the docket intake loads the whole catalogue to match
against), and the platform-admin organisation page lists every auth user on each view.

---

## Expiry board layout

**Reported (2026-10-03):** on the expiry board, "Needs an answer today" (Last day, Half price,
Check) fills the screen, and "Looking ahead" (On half price, Coming up) only appears after a
long scroll. Nobody will scroll that far, so the look-ahead columns are effectively hidden.

**Current layout:** two groups, each a row of its own columns, stacked one above the other
([expiry-board.tsx](../src/components/expiry-board.tsx)). It replaced a single grid that left
large empty gaps beside long columns.

**To do:** redesign the page so both groups are visible without scrolling far. Ideas to weigh
when it is picked up, not decided:

- Tabs or a toggle between "Today" and "Looking ahead".
- One row of five columns that each scroll on their own, with the page height fixed.
- Show only the first few cards per column with a "Show all (N)" link.
- Put "Coming up" first on a manager's view and "Needs an answer" first on staff's.

---

## Known issue: shelf-life group uses the delivery's close date

**Found in review (2026-10-03), parked:** a batch's group (short / medium / long-life), which
decides when its half-price reminder comes, is set from the day its delivery was **closed**
(`stock_batches.created_at`), not the day the stock arrived. The expiry date and the "days left"
countdown are unaffected; only which reminder plan applies.

**When it matters:** a delivery left open for several days, holding an item close to a group
boundary. A yoghurt that arrives with 23 days (medium-life, half price 7 days out) in a delivery
closed 3 days later counts as 20 days (short-life, half price 2 days out).

**Possible fixes, if it shows up in practice:** use the delivery's `received_at`, or the date
printed on the docket, as the arrival day. Not done yet because it adds a second date to carry
through intake for a rare case; deliveries are normally closed the same day.

---

## Scheduled jobs for sites outside Melbourne's timezone

**Context (2026-10-03):** every date is now worked out on each site's own calendar (required
`sites.timezone`), including in the nightly expiry engine. The job still *runs* on
Melbourne's clock, at 03:00 Australia/Melbourne (pg_cron job, 2026-10-06).

**Why it matters later:** at 03:00 in Melbourne it is still the previous evening in Perth, so a
Perth site's reminders would be planned for the day that is ending. All current sites are in Melbourne, so nothing is wrong today.

**When a site outside Melbourne's zone is added:** run the engine hourly (it is a full,
idempotent recompute, so extra runs are harmless): change the cron to `0 * * * *` and
`expiry_engine_due()` to run per site at that site's 03:00.

## If lock-screen notifications come back

**Context (2026-10-05):** reminders moved in-app, per account (banner, pop-up, Today-tab count),
and device Web Push was removed: the `daily-digest` Edge Function, the service worker's push
handlers, the Settings switch and the `push_subscriptions` table. The trade-off is that nothing
reaches anyone while ShelfLife is closed.

**What was learned, in case push returns:** `web-push` (npm) does work from the Supabase Edge
runtime. Three bugs existed in the removed code: an owner's device was saved against one site
instead of organisation-wide; a shared store tablet that changed hands hit an RLS error (the
browser's endpoint is unique and was stored under the previous user) and on *Turn on* also
unsubscribed the browser; and failed sends other than 404/410 were counted as quiet skips, so
wrong VAPID keys would never have shown in `job_runs`. Browsers keep a subscription per device,
so a push design has to decide who owns a shared device.

# ShelfLife — backlog

Work that has been agreed but not scheduled. Each item records what was asked for and what
is already known, so it can be picked up without re-deriving the context.

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

**Partly done (2026-09-30):** Site → Deliveries lists deliveries by supplier and date with
docketed against received quantities, so a supplier's short deliveries show up (filter by the
supplier). Still open: a per-supplier summary page, supplier upkeep (rename, deactivate,
merge) and reviewing suppliers staff created.

**Already in place:** suppliers carry an optional ABN and a list of printed-name aliases,
which intake uses to recognise a supplier from its docket
([docs/ARCHITECTURE.md](ARCHITECTURE.md), docket-driven intake). There is currently no screen
anywhere that edits suppliers.

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

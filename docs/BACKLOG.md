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

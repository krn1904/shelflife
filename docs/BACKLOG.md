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

## Loading states and perceived speed

**Reported:** the app feels slow, and there is no feedback after a tap. Switching between
screens (for example, Shift to another tab) was clicked twice because nothing showed it had
registered, which fetched the page twice and made it slower still.

- No route under `src/app/(portal)/` has a `loading.tsx`, so a navigation shows nothing until
  the server has finished rendering the next page. Adding one per portal (a skeleton of that
  portal's layout) gives immediate feedback and makes a second tap unnecessary.
- Buttons that submit a Server Action should disable themselves while pending. Several do
  (`useActionState` pending), but not all; audit them.
- Find the actual cause of the slowness separately: measure the slowest pages' queries
  (several pages page through whole tables, and the platform-admin organisation page lists
  every auth user) before optimising.

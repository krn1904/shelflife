# ShelfLife — design plan: "Night shift"

Status: **in progress on `feat/night-shift-theme`** — tokens (light + dark with a System / Light / Dark picker), fonts, shell, Today, Receive and the Expiry board are built; browser verification pending. This replaces the warm paper + clay theme in
`src/app/globals.css`. The agreed mockups live on the design canvas (Option C, lime accent):
<https://claude.ai/artifact/4XnsJRRhnk3Wtkgcr7N44k>. Options A (Ledger) and B (Shelf tag)
were considered and set aside.

## Why this direction

- **Built for where the app is used.** Staff use it on a phone in a store room, at the
  counter, and on late shifts. A dark, high-contrast interface is easy to read in dim light
  and doesn't glare.
- **One thing at a time.** Each staff screen leads with the single next action (the next
  item to pull, the next docket line to check). The rest of the list stays visible but
  quieter. This follows the product rule that staff only do work that pays for itself.
- **Not a template look.** No cream background, no clay or terracotta, no purple, no
  gradients, no soft-shadow cards. The look is graphite surfaces, one lime accent, and
  monospaced numbers.

## Foundations

### Colour tokens

These keep the existing token names, so every `bg-*`, `text-*` and `border-*` utility keeps
working and the theme change is mostly a swap of values in `globals.css`.

| Token | Dark (primary) | Light (proposed, see open decisions) | Use |
|---|---|---|---|
| `paper` | `#0F1113` | `#F6F7F8` | page background |
| `surface` | `#181B1F` | `#FFFFFF` | cards, tables, inputs |
| `surface-2` | `#22262B` | `#EEF0F2` | buttons, steppers, hover |
| `ink` | `#ECEEF0` | `#0F1113` | primary text |
| `ink-muted` | `#9AA1A9` | `#565D66` | secondary text |
| `ink-faint` | `#7D848C` | `#6E7680` | hints, timestamps (≥4.5:1 on `paper`) |
| `line` | `#2C3137` | `#E2E5E9` | dividers |
| `line-strong` | `#3A4048` | `#CDD2D8` | input and button borders |
| `brand` | `#C8F25A` | `#C8F25A` | primary button fill, progress, active tab |
| `brand-hover` | `#D6F77E` | `#B9E443` | |
| `brand-ink` | `#0F1113` | `#0F1113` | text on lime: **always dark** |
| `brand-soft` | `#1E2A12` | `#EEF9D0` | ticked fixture chips, selected rows |
| `brand-soft-ink` | `#C8F25A` | `#3F6B00` | text on `brand-soft`; links in light mode |
| `good` / `good-soft` | `#C8F25A` / `#1E2A12` | `#3F6B00` / `#EEF9D0` | confirmed lines |
| `warning` / `warning-soft` | `#F5B544` / `#33280F` | `#8A5A00` / `#FDF0D5` | mark down, short delivery |
| `serious` / `serious-soft` | `#FF9466` / `#35201A` | `#B24A1A` / `#FCE5DA` | |
| `critical` / `critical-soft` / `critical-ink` | `#FF6B5E` / `#3A1A18` / `#FF8A80` | `#C8372D` / `#FBE3E1` / `#A3261E` | pull, overdue, errors |

Rules:
- Lime is **never text on a light surface**: it fails contrast. On light surfaces, lime is
  only used as a fill behind dark text.
- Status pills (Pull, Mark down, days left) use **dark text on a bright fill**: red, amber,
  or graphite for Check. The fills differ in lightness as well as hue, and every pill
  also carries a written label.
- `--shadow` becomes `none` in dark mode. Depth comes from the surface steps
  (`paper` → `surface` → `surface-2`) and 1px lines.

### Typography

- **Instrument Sans** (400/500/600/700) for all text, replacing Geist Sans.
- **JetBrains Mono** (500/700) for anything counted or dated: quantities, days left, docket
  numbers, dates, prices. Always `tabular-nums`.
- Both load through `next/font/google` in `src/app/layout.tsx`, exposed as `--font-sans` and
  `--font-mono` in `@theme`. Check the bundled Next 16 docs (`node_modules/next/dist/docs/`)
  for the current `next/font` API before writing it.
- Scale: page title 30px/700 (phone) and 32px (desktop); card title 22px/700; body 15px;
  meta 12–13px. Section labels are sentence case at 12px/600 in `ink-muted`; this drops the
  uppercase tracked style.

### Shape, spacing, touch

- Radius: 10px for buttons and inputs, 14px for lists, 18–20px for focus cards, 999px for
  chips. `--radius` becomes `0.625rem`.
- Touch targets: **at least 44px** everywhere, 48–52px for primary staff actions, and 64px
  for the delivery quantity stepper.
- Focus: 2px `brand` outline with a 2px offset (unchanged mechanism, new colour).

## Components

| Component | Change |
|---|---|
| `.btn-primary` | Lime fill, dark text, 48px tall on staff screens. |
| `.btn-outline` | `surface-2` fill, `line-strong` border. |
| `.btn-ghost` | Transparent, `ink-muted`. |
| `.field` | `paper` fill inside cards, `line-strong` border, lime border on focus. |
| `.card` | `surface`, 1px `line`, no shadow, 14–20px radius. |
| `.badge` | Becomes the **pill**: mono, 12px/700, 6px radius. |
| `Stat` | Mono value; the `tone` prop maps to `critical`/`warning`/`brand`. |
| **New `DaysLeft`** | Mono pill taking `daysLeft` and an action kind; the colour comes from one shared function, so Today, Expiry and Receive always agree. |
| **New `ProgressBar`** | Segmented (Today: one segment per task) or continuous (Receive: line n of N). |
| **New `FixtureChip`** | A checkbox styled as a pill; ticked uses `brand-soft`. |
| **New `BottomTabs`** | Staff phone navigation: Shift `/app`, Today `/app/today`, Receive `/app/deliveries`, Waste `/app/waste`, Scan `/app/scan`. Shown below `sm` for the staff role only; managers and owners keep the top bar. |
| `PortalShell` / `PortalNav` | Graphite top bar; the active tab is a `surface-2` pill. The lime square stays as the logo mark. |

Charts: `src/lib/charts/tokens.ts` was validated against a **white** surface. `SERIES`,
`CHART_INK` and `STATUS` must be re-run through the dataviz validator against `#181B1F` (and
against the light surface if light mode ships). Don't reuse the current values on dark.

## Screens

### Staff (phone first)

1. **Today** (`/app/today`, `today-list.tsx`)
   - Header shows the site, date and a segmented progress bar ("2 of 7 done").
   - **Next up**: the most urgent open item (pull first, then mark down, then check, by due
     date) as a large card. For a pull it shows *Pull & record waste* (primary), *Done* and
     *Not here*.
   - **Then**: the remaining items as compact rows with a `DaysLeft` pill. Tapping a row
     promotes it to Next up.
   - **Walk past**: fixtures as `FixtureChip`s.
   - Keep the optimistic hide and rollback behaviour exactly as it is. Only the layout
     changes.
2. **Receive delivery** (`/app/deliveries/[deliveryId]`, `intake-client.tsx`)
   - Header: supplier, docket number, chips for "Docket · n rows read" and how the supplier
     was recognised.
   - **One line at a time** in a focus card: product name (mono when taken as printed),
     *New item* pill, 64px stepper with "docket N" under the received quantity, and the
     expiry input. Rotation lines hide the date field.
   - Checked lines collapse into a list below that shows qty and date, or "16 of 18 · short
     2" in `warning`.
   - Footer: ← previous line, then *Confirm & next line*. The last line turns the button into
     *Close delivery*.
   - Keep a "Show all lines" toggle that falls back to the full list, so staff who work
     down the paper docket aren't forced into the stepper flow. The server actions and
     docketed/received data are unchanged.
3. **Receive start, deliveries list, Waste, Scan, Settings, docket test bench**: retheme
   onto the new classes and primitives. No flow changes.

### Manager and owner (desktop first, must work at phone width)

4. **Expiry board** (`/manage/expiry`)
   - Replace the four columns with **one table** grouped by bucket (Overdue, Due today,
     Within 7 days, Within 30 days), with filter buttons that show counts.
   - Columns: product, left, expires, days left (pill when ≤ 0, otherwise mono number plus a
     30-day bar), and a note column for *Date never confirmed*.
   - The table scrolls horizontally inside its box on narrow screens.
5. **Site dashboard, products and ranging, waste, delivery review, Group dashboard**: retheme.
   Stats use mono values, and charts use the revalidated dark palette.
6. **Platform admin, login, landing**: retheme only.

## Rollout

Each step is one PR, with tests and the README/docs updates it affects. Nothing merges to
`main` without both.

1. **Foundations.** Tokens, fonts, component classes, `PortalShell`/`PortalNav`, new
   primitives (`DaysLeft`, `ProgressBar`, `FixtureChip`, `BottomTabs`), and chart tokens
   revalidated. Unit tests for the shared tone/label logic behind `DaysLeft` (bucket,
   colour, "expired 1 day ago" / "in 2 days" copy) and the "next up" ordering.
2. **Staff screens.** Today, then Receive (the largest change), then the rest of the staff
   portal. Tests cover the next-up selection and the line-by-line intake navigation
   (previous/next, last line closes, show-all toggle).
3. **Manager and owner screens.** Expiry board table and filters, then the remaining
   `/manage` and `/owner` pages.
4. **Admin, login, landing**, and removal of every remaining raw `neutral-*`, `red-*` and
   `amber-*` class. A `grep` for them should come back empty.

Each PR is checked in the browser at 390px and 1280px wide. The check covers contrast on
every text/fill pair, 44px targets, keyboard focus, and an idle page that settles (no
running timers or effects).

## Open decisions

1. **Dark only, or follow the device setting?** The recommendation is to follow the device
   setting, with dark as the default. The light column above is a proposal and needs its own
   mockup pass before it ships.
2. **Bottom tabs for managers on a phone?** The plan assumes no: they keep the top bar.
3. **Receive default mode:** one line at a time (planned), or the full list with the focus
   card as an option.

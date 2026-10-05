# ShelfLife — design system: "Night shift"

Status: **built on `feat/night-shift-theme`, not yet merged.** This replaced the warm paper +
clay theme. The agreed mockups live on the design canvas (Option C, lime accent):
<https://claude.ai/artifact/4XnsJRRhnk3Wtkgcr7N44k>. Options A (Ledger) and B (Shelf tag)
were considered and set aside.

## Why this direction

- **Built for where the app is used.** Staff use it on a phone in a store room, at the
  counter, and on late shifts. A dark, high-contrast interface is easy to read in dim light
  and doesn't glare. A light theme is there for daytime and bright counters.
- **One thing at a time.** Each staff screen leads with the single next action (the next
  item to pull, the next docket line to check). The rest of the list stays visible but
  quieter. This follows the product rule that staff only do work that pays for itself.
- **Not a template look.** No cream background, no clay or terracotta, no purple, no
  gradients, no soft-shadow cards. The look is graphite surfaces, one lime accent, and
  monospaced numbers.

## Light and dark

- The app follows the device's light/dark setting by default ("System").
- Anyone can override it with the **System / Light / Dark** switch: in the header from large
  screens up, and on **Settings** (`/app/settings`) for every role.
- The choice is a `theme` cookie (`light` or `dark`; no cookie means System), kept for a
  year on that device. The root layout reads it and writes `data-theme` on `<html>`, so the
  first paint is already in the right theme, with no flash and no script. Parsing is in
  [src/lib/theme/theme.ts](../src/lib/theme/theme.ts) and only accepts the two exact values.
- CSS does the rest: light tokens on `:root`, dark tokens under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under
  `:root[data-theme="dark"]`. Each block sets `color-scheme`, so date pickers, selects and
  scrollbars follow the theme too.

## Foundations

### Colour tokens

These keep the existing token names, so every `bg-*`, `text-*` and `border-*` utility works
in both themes. Values live in [src/app/globals.css](../src/app/globals.css).

| Token | Dark | Light | Use |
|---|---|---|---|
| `paper` | `#0F1113` | `#F6F7F8` | page background |
| `surface` | `#181B1F` | `#FFFFFF` | cards, tables, inputs |
| `surface-2` | `#22262B` | `#EEF0F2` | buttons, steppers, hover |
| `ink` | `#ECEEF0` | `#0F1113` | primary text |
| `ink-muted` | `#9AA1A9` | `#565D66` | secondary text |
| `ink-faint` | `#8A9199` | `#646B74` | hints, timestamps |
| `line` | `#2C3137` | `#E2E5E9` | dividers |
| `line-strong` | `#3A4048` | `#CDD2D8` | button and panel borders |
| `field-border` | `#6B727B` | `#848B94` | input edges |
| `brand` | `#C8F25A` | `#C8F25A` | primary button fill, progress, active tab |
| `brand-hover` | `#D6F77E` | `#B9E443` | |
| `brand-ink` | `#0F1113` | `#0F1113` | text on lime: **always dark** |
| `brand-soft` | `#1E2A12` | `#EEF9D0` | ticked fixture chips |
| `brand-soft-ink` | `#C8F25A` | `#3F6B00` | text on `brand-soft` |
| `brand-text` | `#C8F25A` | `#3F6B00` | accent-coloured text, checkbox and radio accent |
| `focus` | `#C8F25A` | `#0F1113` | focus rings |
| `good` / `good-soft` | `#C8F25A` / `#1E2A12` | `#3F6B00` / `#EEF9D0` | confirmed lines |
| `warning` / `warning-soft` | `#F5B544` / `#33280F` | `#8A5A00` / `#FDF0D5` | mark down, short delivery |
| `warning-fill` | `#F5B544` | `#F5B544` | Mark down and due-today pill fill |
| `serious` / `serious-soft` | `#FF9466` / `#35201A` | `#B24A1A` / `#FCE5DA` | |
| `critical` / `critical-soft` / `critical-ink` | `#FF6B5E` / `#3A1A18` / `#FF8A80` | `#C8372D` / `#FBE3E1` / `#A3261E` | pull, overdue, errors |
| `critical-fill` | `#FF6B5E` | `#E5483C` | Pull and overdue pill fill |

Rules:
- Lime is **never text on a light surface**: it is about 1.3:1 on white. Use
  `text-brand-text` for accent-coloured text and `--focus` for focus rings.
- Status pills use **dark text on a bright fill**: red, amber, or graphite for Check. The
  fills differ in lightness as well as hue, and every pill also carries a written label.
- `--shadow` is `none` in dark mode. Depth comes from the surface steps
  (`paper` → `surface` → `surface-2`) and 1px lines.

### Contrast

Every text/background pair was computed against WCAG 2.2 in both themes:

- **Text, 4.5:1 or better:** ink, muted and faint on every surface; accent text; text on every
  soft fill; dark text on lime, amber and red pill fills.
- **Controls and focus, 3:1 or better:** focus rings, input borders (`field-border`) and the
  chart line on both surfaces.

The two pairs that failed during checking were fixed: faint text on `surface-2`, and input
borders that used `line-strong` (about 1.5:1).

### Typography

- **Instrument Sans** (400–700) for all text, replacing Geist Sans.
- **JetBrains Mono** (500/700) for anything counted or dated: quantities, days left, docket
  numbers, dates, prices. Always `tabular-nums`.
- Both load through `next/font/google` in [src/app/layout.tsx](../src/app/layout.tsx) as
  `--font-instrument-sans` and `--font-jetbrains-mono`, mapped to `font-sans` / `font-mono`.
- Page titles are 30px/700 on a phone and 32px from `sm`. Section labels are sentence case at
  12px/600 in `ink-muted`; the old uppercase tracked style is gone.

### Shape, spacing, touch

- Radius: 10px for buttons and inputs, 14px for cards and lists, 18–20px for focus cards,
  999px for chips.
- Touch targets: **at least 44px** everywhere, 48–52px for primary staff actions, 56px for
  the delivery quantity stepper.

## Components

| Piece | Where | Notes |
|---|---|---|
| `.btn` + `-primary` / `-outline` / `-ghost` / `-danger` / `-sm` | globals.css | 44px default height; `-sm` (36px) for dense desktop rows |
| `.field` | globals.css | `field-border` edge, focus colour on focus |
| `.card`, `.badge-*`, `.alert-*`, `.table` | globals.css | alerts replace hand-rolled bordered error/notice boxes |
| `.pill` + `-critical` / `-warning` / `-neutral` / `-quiet` | globals.css | mono status pill for days left and actions |
| `ReminderCard` (+ `featured`, `compact`) | [src/components/reminder-card.tsx](../src/components/reminder-card.tsx) | Today and Expiry board cards: status pill (Last day red, Half price amber, Check graphite), name, instruction, one-tap answers. Wording and order come from [today.ts](../src/lib/expiry/today.ts) and [board.ts](../src/lib/expiry/board.ts) |
| `stepLine`, `linePosition` | [src/lib/intake/walk.ts](../src/lib/intake/walk.ts) | moving through a delivery one line at a time |
| `ThemePicker` | [src/components/theme-picker.tsx](../src/components/theme-picker.tsx) | System / Light / Dark |
| `BottomTabs` + `SHIFT_TABS` | [bottom-tabs.tsx](../src/components/bottom-tabs.tsx), [shift-tabs.ts](../src/components/shift-tabs.ts) | staff only: Shift, Today, Receive, Board, Scan. Bottom tabs below `sm`; the same links sit in the header from `sm` up |
| `PortalShell` / `PortalNav` | src/components | active tab is a `surface-2` pill; on a phone the portal tabs take their own row |
| `Stat` | src/components/stat.tsx | mono value; `tone` is `brand` / `warning` / `critical`. Four-tile rows are two columns on a phone |

Charts: the series colour `#2A78D6` passes the dataviz validator against both the light
`#FFFFFF` and dark `#181B1F` surfaces, so one value serves both. Grid, axis, tick and label
colours come from the theme through the `.chart` rules in globals.css, because Recharts
writes them as SVG attributes that CSS overrides. Tooltips use `TOOLTIP_STYLE` from
[src/lib/charts/tokens.ts](../src/lib/charts/tokens.ts).

## Screens

### Staff (phone first)

1. **Today** (`/app/today`)
   - Answers, wording and order come from the reminder plans (`today.ts`, `byUrgency`):
     Last day, then Half price, then Check.
   - **Next up** is the most urgent card in the larger `featured` size; the rest follow under
     **Then**. Every answer is one tap and works offline (`sendOrQueue`).
   - **Walk past**: fixtures as tick chips.
2. **Receive delivery** (`/app/deliveries/[deliveryId]`)
   - **One line at a time** by default: "Line n of N" with a progress bar, a focus card with
     56px steppers, ← previous and **Next line**, and a numbered list of every line below
     (tap to jump). On the last line the button becomes "All lines checked · review and
     close", which jumps to the close form.
   - **Show all lines** switches to the full list. On a phone the product name takes its own
     row there, with the counts underneath.
   - The server actions, docket handling, catalogue search and payload are unchanged; both
     views render the same state.
3. **Receive start, deliveries list, Scan, Settings**: rethemed. Staff Waste moved into Scan and Today with the reminder-plans work, so its tab became Board. The docket OCR test
   bench was removed once docket reading was settled.
   The deliveries list rows are restacked for phones.

### Manager, owner and admin (desktop first, work at phone width)

4. **Expiry board** (`/manage/expiry`, and `/app/board` for staff): the reminder board from
   the reminder-plans work. "Needs an answer today" (Last day, Half price, Check) takes the
   same answers as Today; "Looking ahead" shows On half price and Coming up. Column markers
   match the pill colours.

   [board-data.ts](../src/lib/expiry/board-data.ts) fetches only what can appear as a
   card:
   - every batch with an open reminder today, however far out;
   - batches dated up to the end of the look-ahead window;
   - batches already on half price.

   Everything else is a database count ("N more dated batches expire later"). It used to
   download every dated batch at the site, about 400–500 per demo site; it now loads about
   30–50, with the same cards in the same columns (checked on all three demo sites).
5. **Delivery review** (`/manage/deliveries/[id]`): on a phone the table keeps Product,
   Against the docket (with "received of docketed") and Expiry. Docket and Received columns
   join from `sm` up. Correction mode (`?edit=1`) swaps the table for one card per line, so
   the inputs fit a phone.
6. **Site, Products, Waste, Deliveries, Group, Platform, organisation detail, login**:
   rethemed.

## Differences from the mockups

- The Receive button says **"Next line"**, not "Confirm & next line". Moving on does not
  confirm the proposed expiry date: that still needs the existing "Looks right" button, so
  staff can't confirm dates just by tapping through.
- The Receive header has no "Docket · n rows read" chips. The existing docket section already
  says how the docket was read.
- The Expiry board's bars only appear from `sm` up.

## Decisions settled

1. **Light and dark both ship.** The app follows the device by default, with a manual
   override.
2. **Bottom tabs are for staff only.** Managers, owners and admins keep the top tabs; on a
   phone those take their own row.
3. **Receive defaults to one line at a time**, with "Show all lines" one tap away.

## Verification done

- `npm test`, `npx eslint src`, `npx tsc --noEmit` and `npm run build` pass.
- In the browser: staff, manager and platform-admin accounts at 375px (phone), 768px (tablet)
  and desktop, in light and dark.

# ShelfLife — product specification

## Overview

ShelfLife is a multi-tenant back-of-house operations system for convenience retail. Each customer
company is an **organisation** with one or more sites. ShelfLife records what arrives from
suppliers, tracks expiry dates on the stock that needs it, and surfaces a daily action list so
product is pulled or marked down before it becomes a write-off.

Built servo-first for the Australian market. Applicable to any small-format retailer that takes
supplier deliveries and carries dated stock.

---

## The problem

Small-format retail sites rarely track expiry systematically. Deliveries arrive, dockets go to the
manager, and stock goes on the shelf. Whether something is close to date is discovered by a staff
member noticing, or by a customer complaining.

The loss is not evenly distributed, and this is the insight the product is built on:

**Short-life stock is not the problem.** Milk, bread, sandwiches and bakery arrive daily or
near-daily and are front-of-mind, so staff rotate them without prompting. The system does not need
to help here, and asking staff to record dates on high-frequency items adds friction with no return.

**Medium and long-life stock is where money disappears.** A case of energy drinks or protein bars
with a 6–12 month date goes to the back of the store room and is not looked at again. By the time
anyone notices, it is months past date and the whole case is written off. Nobody was negligent;
there was simply no mechanism that would ever surface it.

ShelfLife exists to be that mechanism, while asking as little of staff as possible.

---

## Users

| User | Context | Needs |
|---|---|---|
| **Console staff** | Phone in hand, mid-shift, often in a store room or cool room with poor signal | Receive a delivery fast; be told what to discount or pull today, and answer it in a tap |
| **Site manager** | Desktop or tablet in the back office | See what is expiring, what was received, what was written off and why |
| **Owner / multi-site** | Owns or franchises several sites | Compare sites, see waste in dollars, spot which site or supplier is the problem |
| **Platform admin** | Operating the service | Support organisations, monitor scheduled jobs (moderating the shared product catalogue is planned, not built) |

---

## Core concept: tracking modes

Every product carries exactly one tracking mode. This is what keeps the system usable on a busy
shift, and it is the product's central design decision.

| Mode | Applies to | At intake | How it surfaces |
|---|---|---|---|
| `rotation` | Milk, bread, sandwiches, bakery — short life, high frequency | Nothing captured | A daily tick-list per fixture: "check dairy fridge", "check sandwich cabinet" |
| `batch` | Drinks, snacks, chilled cases, grocery — real date codes | One expiry date per line | Half price, then a last-day call; long-life stock also gets an early check |
| `none` | Cigarettes, accessories, phone cards | Quantity only | Never |

The effect is that staff record dates only for stock that would otherwise go unnoticed.

---

## Key flows

### Receiving a delivery

Intake works down the docket rather than around a barcode scanner, because the docket already
enumerates exactly what arrived.

1. **Photograph the docket.** Stored against the delivery, so the manager sees it without anyone
   sending a photo by text.
2. **Read it.** The operator taps **Read docket**, choosing the reader: AWS Textract (reads printed
   tables column by column, billed per photo) or the free reader that runs on the device. Reading
   is a deliberate tap, so a blurry photo can be retaken before anything is billed.
3. **Confirm the supplier.** It is recognised from the docket: its ABN first, then a printed name
   confirmed on an earlier docket, then its name in the letterhead. The operator confirms or
   changes it. A supplier that is not on the list yet is added on the spot (staff may do this),
   pre-filled with the name and ABN read from the docket; a business already on the list under the
   same ABN or name is reused instead of duplicated. With no docket to read, the operator picks
   the supplier from the list.
4. **Confirm what came.** The line list is the docket, one card per row. A row is linked to the
   catalogue only when it is plainly a known product; otherwise the OCR is trusted, the row keeps
   the name the docket prints (editable), and it is marked as a new item to double-check, with a
   likely catalogue product offered but never applied on its own. New items become the
   organisation's own products when the delivery closes (never the shared catalogue), so the next
   docket naming them links outright. Adjust counts where
   they differ; untick a line that did not arrive. The docketed quantity is recorded separately from the received
   quantity, so a short delivery, including one that did not arrive at all, is on record. When no
   docket was read, the list is predicted from the supplier's recent deliveries instead.
5. **Confirm dates — one per line, never per box.** The expiry belongs to the SKU line and covers
   every box of that SKU in the delivery. Coke Zero 1.5L × 2 boxes is one line with one date;
   Coke Zero 2L × 2 boxes is a separate line with its own date. The app proposes each date from the
   product's shelf life or the last date seen from that supplier, so the usual action is a tap to
   confirm rather than typing.
6. **Optionally photograph the date panel.** Kept as evidence for audit and supplier disputes.

Target: a repeat delivery from a known supplier closes in under 60 seconds.

### Reviewing deliveries

A manager (or an owner, per site) checks what staff received under **Site → Deliveries**:

1. **What is still open**, with who started it and for how long, since a delivery nobody closed
   records no stock.
2. **What closed**, filtered by date range and supplier, with each delivery marked as received
   as docketed or short (and how many lines never arrived).
3. **One delivery in full:** who received it and when (in the store's time), each line's
   docketed against received quantity, the expiry dates entered and whether someone checked
   them, items first added from a docket, the docket photo, and what the reader found on it.

The review is read-only: the saved lines are the record.

### The daily action list

A scheduled job runs overnight and rebuilds the action list from current stock. When staff and
managers open ShelfLife they see what is due today at their site: a banner on their home screen,
a pop-up the first time that day, and (for staff) a count on the Today tab. Reminders belong to
the account, not the phone, so there is nothing to switch on per device. Owners and platform
admins don't get shift reminders. (An owner email digest is planned but not built.)

Managers can also send their staff a short note (**Site → Message staff**): it stays at the top
of every staff page until each person taps **Got it**, and the manager sees who has read it.
Staff don't reply in the app.

How early an item is mentioned depends on its **shelf life when it arrived**, because a 14-day
smoothie and an 8-month bag of chips need very different warnings. Each batch is put in a group
once, from its expiry date minus the day it arrived, and stays there:

| Group (defaults) | Example | Reminders |
|---|---|---|
| Short-life, up to 21 days | Milk drinks, smoothies, protein shakes | Half price 2 days before expiry, then the last day |
| Medium-life, up to 90 days | Some chilled lines | Half price 7 days before, then the last day |
| Long-life, longer | Chips, drinks, grocery | Early check 30 days before (time to face it up or put it on special), half price 7 days before, then the last day |

A manager (or the owner) can change the boundaries and the days for their site under
**Site → Reminder settings**. Settings that would remind staff on the day an item arrives are
refused with a plain explanation, and changes apply from the next morning's list.

Each card is answered in one tap at the shelf:

- **Check** → *Checked*.
- **Half price** → *Reduced price* (it is on half price now), or *Gone* (sold, none left).
- **Last day** → *Pulled out*, with how many were binned (pre-filled with all of them), or
  *Sold*. The card says when the item went to half price.

An answered card moves the batch on to its next reminder instead of repeating; an item already
on half price waits quietly for its last day. Answers work without signal and are sent when the
phone reconnects.

### The expiry board

The same cards, laid out as a board staff and managers can both open (staff from Today or the
Shift home, managers under **Site → Expiry board**, for any of their sites). Its columns follow
the same reminder logic, so the board and the Today list never disagree:

| Column | What is in it | Answers |
|---|---|---|
| Last day | Expiry day or past | Pulled out (how many) / Sold |
| Half price | Half price due now | Reduced price / Gone |
| Check | Long-life early check due now | Checked |
| On half price | Already marked down, waiting for its last day | Sold out |
| Coming up | Dated stock with nothing due yet, as far ahead as the site's early check (30 days by default); anything later is counted | Sold out |

The first three columns are exactly the Today list. The last two let staff look ahead, and mark
stock sold out when it goes early. Dates nobody confirmed at intake are flagged on the card.

### Recording waste

Expired stock needs no separate step: answering *Pulled out* on a last-day card records the
binned quantity as expired waste. Because the system knows unit cost (the site's own, or the unit
price read off the delivery docket), this produces the number the business cares about: dollars
written off this month.

Nothing else is logged as waste. Damaged, spoiled or recalled stock is rare at a servo and not
worth a staff member's time to record, so there is deliberately no separate write-off screen.

---

## Roles and access

Four roles, enforced at the database level so organisation isolation does not depend on UI correctness:

- **`platform_admin`** — across organisations; provision, archive and restore organisations; support access is audit-logged
- **`owner`** — every site in their organisation; analytics, and adding or removing staff and managers
- **`manager`** — one site; deliveries, expiry board, waste, product settings, reminder settings, messages to staff, adding or removing staff
- **`staff`** — one site, phone only; receive, action list, expiry board, waste, rotation checks, the manager's messages

---

## Scope

**v1 — delivery intake and the expiry engine.** Suppliers, product catalogue, docket-driven
intake, expiry tracking and prediction, the daily action list, rotation checklists, waste capture,
notifications, and the four role-scoped portals. Offline-capable on the phone.

**v2 — reconciliation.** Ordered vs docketed vs received vs invoiced, variance flagging, and
supplier performance scoring. The data model already separates docketed from received quantity, so
this needs no migration.

**v3 — compliance and automation.** Temperature logging for fridges and warmers with council-ready
export, and OCR of the docket and date photos already being captured.

### Explicit non-goals

Not a point-of-sale system, not an ordering or procurement system, not a rostering or payroll tool,
and not an accounting integration. It records what arrives and what is thrown away.

---

## Constraints and assumptions

- **Signal is unreliable.** Store rooms and cool rooms frequently have no usable connection, so the
  phone app must work fully offline and sync when it reconnects.
- **Staff turnover is high and training time is near zero.** Any flow that cannot be learned by
  watching it once will not be used.
- **There is no free, comprehensive Australian product barcode database.** The product catalogue is
  shared across organisations and grows as sites scan unknown barcodes, so each product is identified once
  for everybody.
- **Dockets are paper.** The photograph is the record until OCR arrives in v3.

---

## What success looks like

- A repeat supplier delivery is received in under 60 seconds
- Staff record expiry dates for fewer than a third of the lines they handle
- A site can state, in dollars, what it wrote off last month and how much of it was avoidable
- Expired stock is found by the system before it is found by a customer

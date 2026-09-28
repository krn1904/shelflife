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
| **Console staff** | Phone in hand, mid-shift, often in a store room or cool room with poor signal | Receive a delivery fast; be told what to pull today; record waste in seconds |
| **Site manager** | Desktop or tablet in the back office | See what is expiring, what was received, what was written off and why |
| **Owner / multi-site** | Owns or franchises several sites | Compare sites, see waste in dollars, spot which site or supplier is the problem |
| **Platform admin** | Operating the service | Support organisations, moderate the shared product catalogue, monitor scheduled jobs |

---

## Core concept: tracking modes

Every product carries exactly one tracking mode. This is what keeps the system usable on a busy
shift, and it is the product's central design decision.

| Mode | Applies to | At intake | How it surfaces |
|---|---|---|---|
| `rotation` | Milk, bread, sandwiches, bakery — short life, high frequency | Nothing captured | A daily tick-list per fixture: "check dairy fridge", "check sandwich cabinet" |
| `batch` | Drinks, snacks, chilled cases, grocery — real date codes | One expiry date per line | Automatically at 30, 14, 7, 3 and 1 days out |
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

### The daily action list

A scheduled job runs overnight and rebuilds the action list from current stock. Each morning the
on-shift manager receives a push notification and the owner an email digest. The list groups by
fixture and states the action plainly: pull, mark down, or check.

### Recording waste

Anything pulled is scanned out with a reason code and a quantity. Because the system knows unit
cost, this produces the number the business actually cares about: dollars written off this month,
split by how much was avoidable.

---

## Roles and access

Four roles, enforced at the database level so organisation isolation does not depend on UI correctness:

- **`platform_admin`** — across organisations; provision, archive and restore organisations; support access is audit-logged
- **`owner`** — every site in their organisation; analytics and user management
- **`manager`** — one site; deliveries, expiry board, waste, product settings
- **`staff`** — one site, phone only; receive, action list, waste, rotation checks

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

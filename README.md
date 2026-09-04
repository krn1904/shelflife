# ShelfLife

Back-of-house operations for convenience retail. Track what arrives, know what expires, stop
writing off stock nobody noticed.

Built servo-first for the Australian market, generalisable to any small-format retailer.

## The problem

Small-format retail loses money to expiry in a place nobody looks. Short-life stock — milk,
bread, sandwiches — is rotated daily because it arrives constantly and is front-of-mind.
The invisible loss is medium and long-life stock sitting at the back of the store room with a
6–12 month date that no one checks until it is months gone.

## The approach

Every product carries one of three tracking modes, so staff only do work that pays for itself:

| Mode | Applies to | At intake | Surfacing |
|---|---|---|---|
| `rotation` | Milk, bread, sandwiches, bakery | Nothing captured | Daily fixture tick-list |
| `batch` | Drinks, snacks, chilled, grocery | One expiry per line | Auto-surfaces at T-30/14/7/3/1 |
| `none` | Cigarettes, accessories | Quantity only | Never |

Intake is **docket-driven, not scan-driven**. The docket already lists what arrived, so the app
pre-populates expected lines from that supplier's history; staff tick what came, adjust quantity,
and confirm a proposed expiry date — one date per SKU line, covering every box of that SKU.

## Status

In development. MVP scope is delivery intake plus the expiry engine. Invoice reconciliation,
temperature/compliance logging and fuel wet-stock reconciliation are designed for but not built.

See [docs/PLAN.md](docs/PLAN.md) for the full build plan.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · Supabase (Postgres, Auth,
Realtime, Storage, Edge Functions) · Postgres RLS for tenant isolation

## Local development

Requires Node 22 (see `.nvmrc`) and the Supabase CLI.

```bash
nvm use
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev
```

# Moving to a hosted Supabase project

Local development runs against Docker. This document is the switch to a hosted project,
which is what makes the build independent of any one machine and is required before the
app can be deployed anywhere.

## 1. Create the project

At [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**:

| Field | Value |
|---|---|
| Name | `shelflife` |
| Region | **Southeast Asia (Singapore)** or **Australia (Sydney)** if offered — closest to Melbourne |
| Database password | Generate a strong one and save it in a password manager |

Region matters more than it looks: every query in this app is a round trip, and a US
region adds roughly 200ms to each one from Melbourne.

Provisioning takes about two minutes.

## 2. Collect four values

From **Project Settings**:

| Where | Value | Goes to |
|---|---|---|
| Settings → API → Project URL | `https://<ref>.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` |
| Settings → API → anon / publishable key | `eyJ…` or `sb_publishable_…` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Settings → API → service_role / secret key | `eyJ…` or `sb_secret_…` | `SUPABASE_SERVICE_ROLE_KEY` |
| Settings → General → Reference ID | `<ref>` | used by `supabase link` |

Newer dashboards label these *publishable* and *secret* rather than *anon* and
*service_role*; they are the same two keys.

> **The service_role key bypasses every RLS policy in this repo.** It is the one
> credential that can read and write across all tenants. Paste it straight into
> `.env.local` (which is git-ignored) rather than into a chat window or a commit.
> If it is ever exposed, rotate it in Settings → API immediately.

## 3. Point the project at it

```bash
cp .env.example .env.local     # then fill in the three values above
supabase link --project-ref <ref>
supabase db push               # applies every migration in supabase/migrations
npm run seed                   # two orgs, so isolation stays testable
npm run check:env              # confirms schema, RLS helpers and row counts
npm run test:rls               # the isolation suite, now against hosted
```

`check:env` reports which of connectivity, schema, or seed state is wrong, rather than
failing with one opaque error.

## 4. Switching back to local

Local and hosted are the same schema; only `.env.local` differs. Keep the local values
commented in the file and swap them back when you want to work offline:

```bash
supabase start
# restore the 127.0.0.1:54421 values in .env.local
```

Local Supabase uses the **544xx** port range here, not Supabase's 543xx defaults, so it
coexists with another local Supabase project on the same machine.

## Deploying the app

Vercel needs the same three variables set as project environment variables. Add them under
Project Settings → Environment Variables, marking `SUPABASE_SERVICE_ROLE_KEY` as available
to the server only — it must never be exposed to the browser, which is why it lacks the
`NEXT_PUBLIC_` prefix.

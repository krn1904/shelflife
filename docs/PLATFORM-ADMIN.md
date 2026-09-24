# Platform administration

This document is the source of truth for ShelfLife's platform-admin workflows. In the UI, an
**organisation** is a customer company or retail group. The database calls it an `org`; “tenant”
is reserved for technical multi-tenant architecture discussions.

## Access and context

- Role: `platform_admin`
- Portal: `/admin`
- Scope: all organisations
- Header identity: `ShelfLife Platform`

A platform admin still has an organisation membership because `memberships.org_id` is required,
but that row is only an authorization anchor. It does not limit platform access to that
organisation.

## Creating an organisation

“New organisation” provisions the minimum usable account in one flow:

1. Organisation name and unique slug
2. First site, timezone and optional address
3. Initial owner name and email

If the email is new, ShelfLife creates a confirmed Auth account and displays its generated password
once. If the email already exists, ShelfLife links the existing account without changing its
password. Creation succeeds only after the organisation, first site and owner membership exist;
those rows and their audit entry are one database transaction. Failed onboarding attempts remove
only a newly created, otherwise-unused Auth account.

The owner signs in through `/login` and is routed to `/owner`.

## Managing people

From `/admin/organisations/[orgId]`, a platform admin can:

- Add or link a person
- Assign `staff`, `manager`, `owner` or `platform_admin`
- Pin staff and managers to one site
- Change roles
- Remove an organisation membership without deleting the Auth account
- Reset a member's password

A password reset requires confirmation, invalidates the current password and displays the new
generated password once. The password itself is never written to the audit log. The current
implementation does not force expiry or a first-login password change, so it must be shared
securely.

## Archiving and restoring

Routine removal is **archive**, never hard deletion.

Archiving:

- Preserves sites, memberships, deliveries, stock, waste and audit history
- Blocks organisation members from application data and shared catalogue access
- Pauses expiry-engine processing and daily notifications
- Leaves the organisation visible to platform admins

Restoring reverses those access and processing restrictions. Hard deletion has no application
policy or UI and remains break-glass database maintenance only.

## Auditing and safety

Platform-admin views and mutations write `platform_admin.*` events. The database audit function
accepts those events only from a platform admin, validates the organisation and site relationship,
and does not accept arbitrary authenticated callers.

Archived organisations are read-only in the admin UI except for Restore. Service-role server
actions independently re-authorize every call because the service key bypasses RLS. Archive and
restore run through database RPCs that update lifecycle state and write the audit event in one
transaction. Database triggers serialize site and membership changes against archival.
Site and membership removal use locked, audited RPCs so normal deletes cannot race an archive;
cascade deletion remains available for explicit break-glass maintenance.
Site creation and membership creation/role changes use the same transactional RPC pattern, so
platform admins cannot bypass audit through direct PostgREST writes. Organisation owners keep
direct insert/update (and membership delete) policies for their own organisation; those paths
cannot be used by a platform admin.
Expiry-engine rebuilds and rotation-check upserts lock each organisation and skip rows whose
organisation is no longer active, so an archive that commits after the job's snapshot cannot
still insert work. The daily digest rechecks organisation status immediately before dispatch
and matches subscriptions by organisation, not site id alone. Owners keep organisation-
scoped insert/update policies for sites and memberships; those policies use `has_org_role(...,
owner)` rather than `can_manage_org`, so they do not reopen a direct platform-admin write path.

## Implementation map

- Dashboard and onboarding: `src/app/(portal)/admin/page.tsx`,
  `src/app/(portal)/admin/organisation-admin.tsx`
- Organisation management: `src/app/(portal)/admin/organisations/[orgId]/`
- Server actions: `src/lib/admin/actions.ts`
- Session/header context: `src/lib/auth/session.ts`, `src/components/portal-shell.tsx`
- Lifecycle and access migrations:
  - `supabase/migrations/20260920000001_org_lifecycle.sql`
  - `supabase/migrations/20260920000002_archived_account_guard.sql`
  - `supabase/migrations/20260920000003_archived_identity_audit.sql`
  - `supabase/migrations/20260920000004_lifecycle_review_hardening.sql`
  - `supabase/migrations/20260920000005_review_followup.sql`
  - `supabase/migrations/20260920000006_audited_admin_writes.sql`
  - `supabase/migrations/20260920000007_atomic_organisation_provisioning.sql`
  - `supabase/migrations/20260920000008_review_scope_and_job_guards.sql`
- Background-job lifecycle filters: `supabase/functions/expiry-engine/index.ts`,
  `supabase/functions/daily-digest/index.ts` (both page all active data rather than relying on
  PostgREST's 1,000-row default response limit). The expiry engine writes actions and rotation
  checks through RPCs that lock each organisation and skip archived rows; the digest rechecks
  organisation status immediately before dispatch and only delivers subscriptions whose
  `org_id` matches the site being processed.
- Owners retain direct insert/update policies for sites and memberships in their own
  organisation. Platform-admin child writes still go through the audited RPCs.
- RLS verification: `scripts/test-rls.ts`

/**
 * Tenant isolation test.
 *
 * The whole product rests on one claim: a user of org A can never read or write
 * a row belonging to org B. That claim is enforced by RLS, so it is tested against
 * a real Postgres with real policies — not mocked.
 *
 * Run: npm run test:rls
 */
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';

config({ path: '.env.local' });

// Credentials, under either of the two names Supabase has used for them. The scripts
// read .env.local directly rather than going through src/lib/supabase/env.ts, because
// that module is compiled for the app and pulls in Next's build-time inlining.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!URL_) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in .env.local');
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local');
if (!ANON_KEY) throw new Error('Set NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) in .env.local');

// Re-bound after the guards: TypeScript drops control-flow narrowing on module-level
// bindings once they are read inside a function body.
const URL = URL_;
const ANON = ANON_KEY;
const SERVICE = SERVICE_KEY;
const PASSWORD = 'shelflife-dev-password';

type Db = SupabaseClient<Database>;

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name} ${detail}`); }
}

async function signIn(email: string): Promise<Db> {
  const db = createClient<Database>(URL, ANON);
  const { error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return db;
}

async function main() {
  const admin = createClient<Database>(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgs } = await admin.from('orgs').select('id, slug');
  const northside = orgs!.find((o) => o.slug === 'northside')!;
  const bayside = orgs!.find((o) => o.slug === 'bayside')!;

  const { count: totalSites } = await admin
    .from('sites').select('*', { count: 'exact', head: true });
  console.log(`\nservice role sees ${orgs!.length} orgs and ${totalSites} sites (RLS bypassed)\n`);

  console.log('northside staff (pinned to one site):');
  const staff = await signIn('staff@northside.test');
  {
    const { data: o } = await staff.from('orgs').select('slug');
    check('sees exactly its own org', o?.length === 1 && o[0].slug === 'northside',
      `got ${JSON.stringify(o?.map((x) => x.slug))}`);

    const { data: s } = await staff.from('sites').select('name, org_id');
    check('sees only its assigned site', s?.length === 1,
      `got ${s?.length} sites: ${JSON.stringify(s?.map((x) => x.name))}`);
    check('no site belongs to another org', (s ?? []).every((x) => x.org_id === northside.id));

    const { data: sup } = await staff.from('suppliers').select('org_id');
    check('sees no foreign suppliers', (sup ?? []).every((x) => x.org_id === northside.id),
      `got ${sup?.length} suppliers`);

    const { data: p } = await staff.from('products').select('id');
    check('global catalogue is readable', (p?.length ?? 0) > 0, `got ${p?.length}`);
  }

  console.log('\nnorthside owner (null site_id = all sites):');
  const owner = await signIn('owner@northside.test');
  {
    const { data: s } = await owner.from('sites').select('name');
    check('sees all three org sites', s?.length === 3,
      `got ${s?.length}: ${JSON.stringify(s?.map((x) => x.name))}`);

    const { error } = await owner.from('sites')
      .insert({ org_id: bayside.id, name: 'Injected site' });
    check('cannot insert a site into another org', error !== null,
      error ? '' : 'insert unexpectedly succeeded');

    const { data: updated } = await owner.from('orgs')
      .update({ name: 'Hijacked' }).eq('id', bayside.id).select();
    check('cannot update another org', (updated?.length ?? 0) === 0,
      `updated ${updated?.length} rows`);

    // No .select() on the insert: RETURNING is checked against sites_select, whose
    // auth_site_ids() snapshot predates the new row, so it would fail a valid insert.
    const ownerSiteName = `Owner site ${Date.now()}`;
    const { error: ownerSiteInsert } = await owner
      .from('sites')
      .insert({ org_id: northside.id, name: ownerSiteName });
    const { data: createdSite } = await owner
      .from('sites')
      .select('id')
      .eq('name', ownerSiteName)
      .maybeSingle();
    check('owner can create a site in their organisation',
      ownerSiteInsert === null && Boolean(createdSite?.id),
      ownerSiteInsert?.message ?? '');

    const { data: renamedSite } = await owner
      .from('sites')
      .update({ name: `Owner site renamed ${Date.now()}` })
      .eq('id', createdSite!.id)
      .select('id');
    check('owner can update a site in their organisation',
      (renamedSite?.length ?? 0) === 1, `updated ${renamedSite?.length} sites`);

    const { data: { user: staffUser } } = await staff.auth.getUser();
    const staffSiteId = (await staff.from('sites').select('id').single()).data?.id;
    const extraSite = (await owner.from('sites').select('id').neq('id', staffSiteId!)).data?.[0];
    const { data: ownerMembership, error: ownerMembershipError } = await owner
      .from('memberships')
      .insert({
        user_id: staffUser!.id,
        org_id: northside.id,
        site_id: extraSite!.id,
        role: 'staff',
      })
      .select('id')
      .single();
    check('owner can add a membership in their organisation',
      ownerMembershipError === null && Boolean(ownerMembership?.id),
      ownerMembershipError?.message ?? '');

    const { data: ownerMembershipUpdate } = await owner
      .from('memberships')
      .update({ role: 'manager' })
      .eq('id', ownerMembership!.id)
      .select('id');
    check('owner can update a membership in their organisation',
      (ownerMembershipUpdate?.length ?? 0) === 1,
      `updated ${ownerMembershipUpdate?.length} memberships`);

    const { data: ownerMembershipDelete } = await owner
      .from('memberships')
      .delete()
      .eq('id', ownerMembership!.id)
      .select('id');
    check('owner can remove a membership in their organisation',
      (ownerMembershipDelete?.length ?? 0) === 1,
      `deleted ${ownerMembershipDelete?.length} memberships`);
    await admin.from('sites').delete().eq('id', createdSite!.id);
  }

  console.log('\nbayside owner (the other tenant):');
  const other = await signIn('owner@bayside.test');
  {
    const { data: o } = await other.from('orgs').select('slug');
    check('sees exactly its own org', o?.length === 1 && o[0].slug === 'bayside',
      `got ${JSON.stringify(o?.map((x) => x.slug))}`);

    const { data: s } = await other.from('sites').select('org_id');
    check('sees no northside sites', (s ?? []).every((x) => x.org_id === bayside.id),
      `got ${s?.length} sites`);

    const { data: sp } = await other.from('site_products').select('org_id');
    check('sees no foreign site_products', (sp ?? []).every((x) => x.org_id === bayside.id));

    // Ranging is the first write path staff-facing UI exposes, and a Server Action is
    // reachable by direct POST — so the posted site_id must be rejected in the database,
    // not only by the application code that normally sets it.
    const { data: theirSite } = await admin
      .from('sites').select('id').eq('org_id', northside.id).limit(1).single();
    const { data: someProduct } = await admin.from('products').select('id').limit(1).single();

    const { error: rangeError } = await other.from('site_products').insert({
      org_id: northside.id,
      site_id: theirSite!.id,
      product_id: someProduct!.id,
      par_level: 99,
    });
    check('cannot range a product at another org\'s site', rangeError !== null,
      rangeError ? '' : 'insert unexpectedly succeeded');

    // Claiming your own org_id while pointing at their site must fail too — the policy
    // has to check the site, not just the org column the caller supplies.
    const { error: spoofError } = await other.from('site_products').insert({
      org_id: bayside.id,
      site_id: theirSite!.id,
      product_id: someProduct!.id,
      par_level: 99,
    });
    check('cannot smuggle a foreign site under its own org_id', spoofError !== null,
      spoofError ? '' : 'insert unexpectedly succeeded');
  }

  console.log('\nglobal catalogue (shared on purpose, but not a free-for-all):');
  {
    const { data: mine } = await staff.from('products')
      .select('id').limit(1).single();

    // Any tenant may ADD to the catalogue — that is the design. Editing someone
    // else's row is a different thing, and must not be allowed.
    const { data: edited } = await other.from('products')
      .update({ name: 'Hijacked product' }).eq('id', mine!.id).select();
    check('cannot rewrite a catalogue row another tenant created',
      (edited?.length ?? 0) === 0, `updated ${edited?.length} rows`);
  }

  console.log('\nintake (deliveries, lines and stock batches):');
  {
    const { data: theirSite } = await admin
      .from('sites').select('id, org_id').eq('org_id', northside.id).limit(1).single();
    const { data: theirSupplier } = await admin
      .from('suppliers').select('id').eq('org_id', northside.id).limit(1).single();
    const { data: product } = await admin.from('products').select('id').limit(1).single();

    // A delivery is the first thing staff create, and it carries both org_id and site_id.
    // Supplying someone else's pair must fail on the site, not merely on the org column.
    const { error: foreignDelivery } = await other.from('deliveries').insert({
      org_id: northside.id,
      site_id: theirSite!.id,
      supplier_id: theirSupplier!.id,
    });
    check('cannot open a delivery at another org\'s site', foreignDelivery !== null,
      foreignDelivery ? '' : 'insert unexpectedly succeeded');

    const { data: seen } = await other.from('deliveries').select('site_id');
    check('sees no foreign deliveries', (seen ?? []).every((d) => d.site_id !== theirSite!.id),
      `got ${seen?.length} deliveries`);

    // stock_batches is what the expiry engine reads. A leak here would surface another
    // tenant's stock on this tenant's board.
    const { error: foreignBatch } = await other.from('stock_batches').insert({
      org_id: northside.id,
      site_id: theirSite!.id,
      product_id: product!.id,
      qty_received: 1,
      qty_remaining: 1,
    });
    check('cannot create a stock batch at another org\'s site', foreignBatch !== null,
      foreignBatch ? '' : 'insert unexpectedly succeeded');

    const { data: batches } = await other.from('stock_batches').select('site_id');
    check('sees no foreign stock batches',
      (batches ?? []).every((b) => b.site_id !== theirSite!.id), `got ${batches?.length} batches`);

    // delivery_lines has no site_id of its own — its policy reaches through the parent
    // delivery. If that join were wrong, lines would leak while deliveries stayed sealed,
    // so this is checked against the parent's site rather than trusted.
    const { data: lines } = await other
      .from('delivery_lines').select('id, deliveries(site_id)');
    const baysideSites = new Set(
      (await other.from('sites').select('id')).data?.map((s) => s.id) ?? [],
    );
    check('every visible delivery line belongs to a site this tenant can see',
      (lines ?? []).every((l) => l.deliveries && baysideSites.has(l.deliveries.site_id)),
      `got ${lines?.length} lines`);
  }

  console.log('\nrole resolution (regression: staff must not inherit a colleague\'s role):');
  {
    // RLS scopes memberships to the ORG, so a staff member legitimately sees the
    // roster — including the platform admin's row. Application code that derives a
    // role from this query without filtering by user_id escalates staff to admin.
    const { data: all } = await staff.from('memberships').select('user_id, role');
    check('org roster is visible (so the hazard is real, not theoretical)',
      (all?.length ?? 0) > 1, `got ${all?.length} rows`);
    check('roster contains a role above staff',
      (all ?? []).some((m) => m.role !== 'staff'));

    const { data: { user } } = await staff.auth.getUser();
    const { data: own } = await staff.from('memberships').select('role').eq('user_id', user!.id);
    check('filtering by user_id yields only the staff role',
      own?.length === 1 && own[0].role === 'staff',
      `got ${JSON.stringify(own?.map((m) => m.role))}`);
  }

  console.log('\norganisation lifecycle:');
  {
    const platform = await signIn('admin@shelflife.test');
    const { data: { user: otherUser } } = await other.auth.getUser();
    const { data: { user: platformUser } } = await platform.auth.getUser();
    const { data: visible } = await platform.from('orgs').select('id, status');
    check('platform admin sees every organisation',
      visible?.length === orgs!.length, `got ${visible?.length}`);

    const { error: directOrgInsert } = await platform
      .from('orgs')
      .insert({ name: 'Bypassed onboarding', slug: `bypass-${Date.now()}` });
    check('platform admin cannot bypass audited organisation provisioning',
      directOrgInsert !== null, directOrgInsert ? '' : 'insert unexpectedly succeeded');

    const provisionSlug = `provision-${Date.now()}`;
    const { data: provisioned, error: provisionError } = await platform.rpc(
      'provision_organisation',
      {
        p_name: 'Atomic provision check',
        p_slug: provisionSlug,
        p_site_name: 'First site',
        p_site_timezone: 'Australia/Melbourne',
        p_site_address: null,
        p_owner_user_id: otherUser!.id,
        p_owner_email: 'owner@bayside.test',
      },
    );
    const provisionResult = provisioned as { org_id?: string; site_id?: string } | null;
    check('organisation, first site, owner and audit provision atomically',
      provisionError === null && Boolean(provisionResult?.org_id) && Boolean(provisionResult?.site_id),
      provisionError?.message ?? '');

    const { data: provisionAudit } = await admin
      .from('audit_log')
      .select('id')
      .eq('org_id', provisionResult!.org_id!)
      .eq('action', 'platform_admin.created_organisation');
    check('provisioning writes its audit entry',
      provisionAudit?.length === 1, `got ${provisionAudit?.length} audit rows`);

    const { data: aggregateProduct } = await admin.from('products').select('id').limit(1).single();
    const wasteRows = Array.from({ length: 1_001 }, () => ({
      org_id: provisionResult!.org_id!,
      site_id: provisionResult!.site_id!,
      product_id: aggregateProduct!.id,
      qty: 1,
      reason: 'expired' as const,
      value_aud: 1,
    }));
    for (let index = 0; index < wasteRows.length; index += 500) {
      const { error } = await admin.from('waste_events').insert(wasteRows.slice(index, index + 500));
      if (error) throw error;
    }
    const { data: wasteTotal, error: wasteTotalError } = await platform.rpc(
      'organisation_waste_total',
      { p_org_id: provisionResult!.org_id! },
    );
    check('database waste aggregate includes rows beyond the 1,000-row API cap',
      wasteTotalError === null && Number(wasteTotal) === 1_001,
      `got ${wasteTotal}; ${wasteTotalError?.message ?? ''}`);
    await admin.from('orgs').delete().eq('id', provisionResult!.org_id!);

    const cascadeSlug = `cascade-${Date.now()}`;
    const { data: cascadeOrg } = await admin
      .from('orgs')
      .insert({ name: 'Cascade check', slug: cascadeSlug })
      .select('id')
      .single();
    const { data: cascadeSite } = await admin
      .from('sites')
      .insert({ org_id: cascadeOrg!.id, name: 'Cascade site' })
      .select('id')
      .single();
    await admin.from('memberships').insert({
      org_id: cascadeOrg!.id,
      site_id: cascadeSite!.id,
      user_id: otherUser!.id,
      role: 'manager',
    });
    const { error: cascadeDeleteError } = await admin.from('orgs').delete().eq('id', cascadeOrg!.id);
    check('hard delete can cascade through sites and memberships',
      cascadeDeleteError === null, cascadeDeleteError?.message ?? '');

    const jobSlug = `job-guard-${Date.now()}`;
    const { data: jobOrg } = await admin
      .from('orgs')
      .insert({ name: 'Job guard', slug: jobSlug })
      .select('id')
      .single();
    const { data: jobSite } = await admin
      .from('sites')
      .insert({ org_id: jobOrg!.id, name: 'Job site' })
      .select('id')
      .single();
    const { data: jobProduct } = await admin.from('products').select('id').limit(1).single();
    const { data: jobBatch } = await admin
      .from('stock_batches')
      .insert({
        org_id: jobOrg!.id,
        site_id: jobSite!.id,
        product_id: jobProduct!.id,
        qty_received: 1,
        qty_remaining: 1,
        expiry_date: '2099-01-01',
      })
      .select('id')
      .single();
    const { error: archiveJobOrg } = await platform.rpc('archive_organisation', {
      p_org_id: jobOrg!.id,
      p_confirm_slug: jobSlug,
    });
    check('job-guard organisation can be archived before engine writes',
      archiveJobOrg === null, archiveJobOrg?.message ?? '');

    const { data: insertedActions, error: archivedActionError } = await admin.rpc(
      'insert_active_expiry_actions',
      {
        p_actions: [{
          org_id: jobOrg!.id,
          site_id: jobSite!.id,
          batch_id: jobBatch!.id,
          action: 'check',
          due_date: '2099-01-01',
        }],
      },
    );
    check('expiry-action job RPC skips archived organisations',
      archivedActionError === null && Number(insertedActions) === 0,
      `inserted ${insertedActions}; ${archivedActionError?.message ?? ''}`);
    const { data: leakedActions } = await admin
      .from('expiry_actions')
      .select('id')
      .eq('org_id', jobOrg!.id);
    check('no expiry actions exist for the archived organisation',
      leakedActions?.length === 0, `got ${leakedActions?.length}`);

    const { data: insertedChecks, error: archivedCheckError } = await admin.rpc(
      'upsert_active_rotation_checks',
      {
        p_checks: [{
          org_id: jobOrg!.id,
          site_id: jobSite!.id,
          fixture: 'cold-room',
          check_date: '2099-01-01',
        }],
      },
    );
    check('rotation-check job RPC skips archived organisations',
      archivedCheckError === null && Number(insertedChecks) === 0,
      `inserted ${insertedChecks}; ${archivedCheckError?.message ?? ''}`);
    const { data: leakedChecks } = await admin
      .from('rotation_checks')
      .select('id')
      .eq('org_id', jobOrg!.id);
    check('no rotation checks exist for the archived organisation',
      leakedChecks?.length === 0, `got ${leakedChecks?.length}`);

    const { error: platformJobWrite } = await platform.rpc('insert_active_expiry_actions', {
      p_actions: [],
    });
    check('platform admin cannot call the service-role expiry-action writer',
      platformJobWrite !== null, platformJobWrite ? '' : 'rpc unexpectedly succeeded');
    await admin.from('orgs').delete().eq('id', jobOrg!.id);

    const { data: baysideSite } = await admin
      .from('sites')
      .select('id')
      .eq('org_id', bayside.id)
      .limit(1)
      .single();
    const { data: northsideSite } = await admin
      .from('sites')
      .select('id')
      .eq('org_id', northside.id)
      .limit(1)
      .single();

    const { error: directSiteWrite } = await platform
      .from('sites')
      .insert({ org_id: bayside.id, name: 'Unaudited site' });
    check('platform admin cannot bypass audited site creation',
      directSiteWrite !== null, directSiteWrite ? '' : 'insert unexpectedly succeeded');

    const { data: directSiteUpdate } = await platform
      .from('sites')
      .update({ name: 'Unaudited rename' })
      .eq('id', baysideSite!.id)
      .select('id');
    check('platform admin cannot bypass audited site updates',
      (directSiteUpdate?.length ?? 0) === 0, `updated ${directSiteUpdate?.length} sites`);

    const { error: directMembershipInsert } = await platform.from('memberships').insert({
      org_id: bayside.id,
      user_id: platformUser!.id,
      site_id: null,
      role: 'owner',
    });
    check('platform admin cannot bypass audited membership creation',
      directMembershipInsert !== null, directMembershipInsert ? '' : 'insert unexpectedly succeeded');

    const { data: rpcSite, error: rpcSiteError } = await platform.rpc('create_organisation_site', {
      p_org_id: bayside.id,
      p_name: 'RPC lifecycle site',
      p_timezone: 'Australia/Melbourne',
      p_address: null,
    });
    check('platform admin can create a site through the audited RPC',
      rpcSiteError === null && Boolean(rpcSite), rpcSiteError?.message ?? '');

    const { data: rpcMembership, error: rpcMembershipError } = await platform.rpc(
      'add_organisation_member',
      {
        p_org_id: bayside.id,
        p_user_id: otherUser!.id,
        p_site_id: rpcSite!,
        p_role: 'manager',
        p_email: 'owner@bayside.test',
      },
    );
    check('platform admin can add a member through the audited RPC',
      rpcMembershipError === null && Boolean(rpcMembership), rpcMembershipError?.message ?? '');

    const { data: orgWideMembership, error: orgWideMembershipError } = await platform.rpc(
      'add_organisation_member',
      {
        p_org_id: bayside.id,
        p_user_id: platformUser!.id,
        p_site_id: null,
        p_role: 'owner',
        p_email: 'admin@shelflife.test',
      },
    );
    check('organisation-wide membership RPC accepts an explicit null site',
      orgWideMembershipError === null && Boolean(orgWideMembership),
      orgWideMembershipError?.message ?? '');
    await platform.rpc('remove_organisation_member', {
      p_membership_id: orgWideMembership!,
    });

    const { error: assignedSiteRemoval } = await platform.rpc('remove_empty_site', {
      p_site_id: rpcSite!,
    });
    check('site with an assigned member cannot be removed',
      assignedSiteRemoval !== null, assignedSiteRemoval ? '' : 'removal unexpectedly succeeded');

    const { data: directMembershipUpdate } = await platform
      .from('memberships')
      .update({ role: 'staff' })
      .eq('id', rpcMembership!)
      .select('id');
    check('platform admin cannot bypass audited membership updates',
      (directMembershipUpdate?.length ?? 0) === 0,
      `updated ${directMembershipUpdate?.length} memberships`);

    const { error: rpcRoleError } = await platform.rpc('update_organisation_member', {
      p_membership_id: rpcMembership!,
      p_site_id: rpcSite!,
      p_role: 'staff',
    });
    check('platform admin can update a member through the audited RPC',
      rpcRoleError === null, rpcRoleError?.message ?? '');

    const { error: rpcMemberRemoval } = await platform.rpc('remove_organisation_member', {
      p_membership_id: rpcMembership!,
    });
    check('platform admin can remove a member through the audited RPC',
      rpcMemberRemoval === null, rpcMemberRemoval?.message ?? '');

    const { error: rpcSiteRemoval } = await platform.rpc('remove_empty_site', {
      p_site_id: rpcSite!,
    });
    check('platform admin can remove an unassigned empty site through the audited RPC',
      rpcSiteRemoval === null, rpcSiteRemoval?.message ?? '');

    const endpoint = `https://push.test/${Date.now()}`;
    const { error: crossOrgSubscription } = await other
      .from('push_subscriptions')
      .insert({
        user_id: otherUser!.id,
        org_id: bayside.id,
        site_id: northsideSite!.id,
        endpoint: `${endpoint}/cross-org`,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      });
    check('subscription cannot reference another organisation site',
      crossOrgSubscription !== null, crossOrgSubscription ? '' : 'insert unexpectedly succeeded');

    const { data: subscription, error: subscriptionError } = await other
      .from('push_subscriptions')
      .insert({
        user_id: otherUser!.id,
        org_id: bayside.id,
        site_id: baysideSite!.id,
        endpoint,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      })
      .select('id')
      .single();
    check('owner can create a subscription in an active organisation',
      subscriptionError === null, subscriptionError?.message ?? '');

    const { data: orgWideSubscription, error: orgWideSubscriptionError } = await other
      .from('push_subscriptions')
      .insert({
        user_id: otherUser!.id,
        org_id: bayside.id,
        site_id: null,
        endpoint: `${endpoint}/org-wide`,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      })
      .select('id')
      .single();
    check('owner can create an organisation-wide subscription',
      orgWideSubscriptionError === null, orgWideSubscriptionError?.message ?? '');
    await other.from('push_subscriptions').delete().eq('id', orgWideSubscription!.id);

    const { data: { user: staffUserForPush } } = await staff.auth.getUser();
    const { data: staffSite } = await staff.from('sites').select('id').single();
    const { error: staffOrgWide } = await staff.from('push_subscriptions').insert({
      user_id: staffUserForPush!.id,
      org_id: northside.id,
      site_id: null,
      endpoint: `${endpoint}/staff-org-wide`,
      p256dh: 'test-p256dh',
      auth: 'test-auth',
    });
    check('staff cannot create an organisation-wide subscription',
      staffOrgWide !== null, staffOrgWide ? '' : 'insert unexpectedly succeeded');

    const { data: staffSubscription, error: staffSubscriptionError } = await staff
      .from('push_subscriptions')
      .insert({
        user_id: staffUserForPush!.id,
        org_id: northside.id,
        site_id: staffSite!.id,
        endpoint: `${endpoint}/staff-site`,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
      })
      .select('id')
      .single();
    check('staff can create a site-scoped subscription',
      staffSubscriptionError === null, staffSubscriptionError?.message ?? '');

    const { data: staffOrgWideUpdate } = await staff
      .from('push_subscriptions')
      .update({ site_id: null })
      .eq('id', staffSubscription!.id)
      .select('id');
    check('staff cannot retarget a subscription to the whole organisation',
      (staffOrgWideUpdate?.length ?? 0) === 0,
      `updated ${staffOrgWideUpdate?.length} subscriptions`);
    await staff.from('push_subscriptions').delete().eq('id', staffSubscription!.id);

    const { data: crossOrgUpdate } = await other
      .from('push_subscriptions')
      .update({ site_id: northsideSite!.id })
      .eq('id', subscription!.id)
      .select('id');
    check('subscription cannot be reassigned to another organisation site',
      (crossOrgUpdate?.length ?? 0) === 0, `updated ${crossOrgUpdate?.length} subscriptions`);

    const { data: ownerMutation } = await other
      .from('orgs')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        archived_by: otherUser!.id,
      })
      .eq('id', bayside.id)
      .select('id');
    check('owner cannot change organisation lifecycle',
      (ownerMutation?.length ?? 0) === 0, `updated ${ownerMutation?.length} rows`);

    const { data: deleted } = await platform
      .from('orgs')
      .delete()
      .eq('id', bayside.id)
      .select('id');
    check('platform admin cannot hard-delete an organisation',
      (deleted?.length ?? 0) === 0, `deleted ${deleted?.length} rows`);

    const { data: directAdminMutation } = await platform
      .from('orgs')
      .update({
        status: 'archived',
        archived_at: new Date().toISOString(),
        archived_by: (await platform.auth.getUser()).data.user!.id,
      })
      .eq('id', bayside.id)
      .select('id');
    check('platform admin cannot bypass audited lifecycle RPCs',
      (directAdminMutation?.length ?? 0) === 0,
      `updated ${directAdminMutation?.length} rows`);

    const { error: archiveError } = await platform.rpc('archive_organisation', {
      p_org_id: bayside.id,
      p_confirm_slug: 'bayside',
    });
    check('platform admin can archive through the audited RPC', archiveError === null,
      archiveError?.message ?? '');

    const [
      { data: archivedOrg },
      { data: archivedSites },
      { data: archivedMemberships },
      { data: archivedProducts },
      { data: archivedProfile },
    ] =
      await Promise.all([
        other.from('orgs').select('id'),
        other.from('sites').select('id'),
        other.from('memberships').select('id'),
        other.from('products').select('id'),
        other.from('profiles').select('id').eq('id', otherUser!.id),
      ]);
    check('archived organisation is hidden from its owner', archivedOrg?.length === 0,
      `got ${archivedOrg?.length} orgs`);
    check('archived sites are hidden from its owner', archivedSites?.length === 0,
      `got ${archivedSites?.length} sites`);
    check('archived memberships are hidden from its owner', archivedMemberships?.length === 0,
      `got ${archivedMemberships?.length} memberships`);
    check('archived owner cannot read the shared catalogue', archivedProducts?.length === 0,
      `got ${archivedProducts?.length} products`);

    const { error: archivedProductWrite } = await other
      .from('products')
      .insert({ name: 'Archived account write', tracking_mode: 'none' });
    check('archived owner cannot add to the shared catalogue', archivedProductWrite !== null,
      archivedProductWrite ? '' : 'insert unexpectedly succeeded');
    check('archived owner cannot read its profile through the app API',
      archivedProfile?.length === 0, `got ${archivedProfile?.length} profiles`);

    const { data: profileUpdate } = await other
      .from('profiles')
      .update({ full_name: 'Archived profile mutation' })
      .eq('id', otherUser!.id)
      .select('id');
    check('archived owner cannot update its profile through the app API',
      (profileUpdate?.length ?? 0) === 0, `updated ${profileUpdate?.length} profiles`);

    const { data: archivedSubscriptions } = await other
      .from('push_subscriptions')
      .select('id')
      .eq('id', subscription!.id);
    check('archived organisation subscription is hidden',
      archivedSubscriptions?.length === 0, `got ${archivedSubscriptions?.length} subscriptions`);

    const { data: subscriptionUpdate } = await other
      .from('push_subscriptions')
      .update({ user_agent: 'archived mutation' })
      .eq('id', subscription!.id)
      .select('id');
    check('archived organisation subscription cannot be updated',
      (subscriptionUpdate?.length ?? 0) === 0, `updated ${subscriptionUpdate?.length} subscriptions`);

    const { data: subscriptionDelete } = await other
      .from('push_subscriptions')
      .delete()
      .eq('id', subscription!.id)
      .select('id');
    check('archived organisation subscription cannot be deleted',
      (subscriptionDelete?.length ?? 0) === 0, `deleted ${subscriptionDelete?.length} subscriptions`);

    const { error: archivedServiceWrite } = await admin
      .from('sites')
      .insert({ org_id: bayside.id, name: 'Post-archive service write' });
    check('service role cannot add a site after archival', archivedServiceWrite !== null,
      archivedServiceWrite ? '' : 'insert unexpectedly succeeded');

    const { error: forgedAudit } = await other.rpc('write_audit', {
      p_action: 'platform_admin.forged',
      p_org_id: northside.id,
      p_subject_type: 'org',
      p_subject_id: northside.id,
    });
    check('non-admin cannot forge platform audit entries', forgedAudit !== null,
      forgedAudit ? '' : 'audit write unexpectedly succeeded');

    const { data: adminView } = await platform
      .from('orgs')
      .select('status')
      .eq('id', bayside.id)
      .single();
    check('platform admin can inspect an archived organisation',
      adminView?.status === 'archived', `got ${adminView?.status}`);

    const { error: restoreError } = await platform.rpc('restore_organisation', {
      p_org_id: bayside.id,
    });
    check('platform admin can restore through the audited RPC', restoreError === null,
      restoreError?.message ?? '');

    const { data: restored } = await other.from('orgs').select('id');
    check('owner access returns after restore',
      restored?.length === 1 && restored[0].id === bayside.id,
      `got ${restored?.length} orgs`);

    await other.from('push_subscriptions').delete().eq('id', subscription!.id);

    await admin.from('orgs').update({ is_demo: true }).eq('id', bayside.id);
    const { error: demoAuditError } = await other.rpc('write_audit', {
      p_action: 'demo.jump_days',
      p_org_id: bayside.id,
      p_subject_type: 'org',
      p_subject_id: bayside.id,
      p_detail: { days: 7, test: true },
    });
    check('authorised demo audit events remain available', demoAuditError === null,
      demoAuditError?.message ?? '');
    await admin.from('orgs').update({ is_demo: false }).eq('id', bayside.id);
  }

  console.log('\nanonymous (no session):');
  {
    const anon = createClient<Database>(URL, ANON);
    for (const table of ['orgs', 'sites', 'suppliers', 'memberships', 'products'] as const) {
      const { data } = await anon.from(table).select('*');
      check(`anon reads zero rows from ${table}`, (data?.length ?? 0) === 0, `got ${data?.length}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nfailures:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

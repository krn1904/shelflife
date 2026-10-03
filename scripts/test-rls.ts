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
// Org A and org B of the seed world (scripts/seed-world.ts).
const ORG_A_SLUG = 'metro-petroleum';
const ORG_B_SLUG = 'united-petroleum';

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
  const metro = orgs!.find((o) => o.slug === ORG_A_SLUG)!;
  const united = orgs!.find((o) => o.slug === ORG_B_SLUG)!;

  const { count: totalSites } = await admin
    .from('sites').select('*', { count: 'exact', head: true });
  console.log(`\nservice role sees ${orgs!.length} orgs and ${totalSites} sites (RLS bypassed)\n`);

  console.log('metro staff (pinned to one site):');
  const staff = await signIn('staff@metro-petroleum.test');
  {
    const { data: o } = await staff.from('orgs').select('slug');
    check('sees exactly its own org', o?.length === 1 && o[0].slug === ORG_A_SLUG,
      `got ${JSON.stringify(o?.map((x) => x.slug))}`);

    const { data: s } = await staff.from('sites').select('name, org_id');
    check('sees only its assigned site', s?.length === 1,
      `got ${s?.length} sites: ${JSON.stringify(s?.map((x) => x.name))}`);
    check('no site belongs to another org', (s ?? []).every((x) => x.org_id === metro.id));

    const { data: sup } = await staff.from('suppliers').select('org_id');
    check('sees no foreign suppliers', (sup ?? []).every((x) => x.org_id === metro.id),
      `got ${sup?.length} suppliers`);

    const { data: p } = await staff.from('products').select('id');
    check('global catalogue is readable', (p?.length ?? 0) > 0, `got ${p?.length}`);
  }

  console.log('\nmetro owner (null site_id = all sites):');
  const owner = await signIn('owner@metro-petroleum.test');
  {
    const { data: s } = await owner.from('sites').select('name');
    check('sees all three org sites', s?.length === 3,
      `got ${s?.length}: ${JSON.stringify(s?.map((x) => x.name))}`);

    const { error } = await owner.from('sites')
      .insert({ org_id: united.id, name: 'Injected site', timezone: 'Australia/Melbourne' });
    check('cannot insert a site into another org', error !== null,
      error ? '' : 'insert unexpectedly succeeded');

    const { data: updated } = await owner.from('orgs')
      .update({ name: 'Hijacked' }).eq('id', united.id).select();
    check('cannot update another org', (updated?.length ?? 0) === 0,
      `updated ${updated?.length} rows`);

    // No .select() on the insert: RETURNING is checked against sites_select, whose
    // auth_site_ids() snapshot predates the new row, so it would fail a valid insert.
    const ownerSiteName = `Owner site ${Date.now()}`;
    const { error: ownerSiteInsert } = await owner
      .from('sites')
      .insert({ org_id: metro.id, name: ownerSiteName, timezone: 'Australia/Melbourne' });
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
        org_id: metro.id,
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

  console.log('\nunited owner (the other tenant):');
  const other = await signIn('owner@united-petroleum.test');
  {
    const { data: o } = await other.from('orgs').select('slug');
    check('sees exactly its own org', o?.length === 1 && o[0].slug === ORG_B_SLUG,
      `got ${JSON.stringify(o?.map((x) => x.slug))}`);

    const { data: s } = await other.from('sites').select('org_id');
    check('sees no metro sites', (s ?? []).every((x) => x.org_id === united.id),
      `got ${s?.length} sites`);

    const { data: sp } = await other.from('site_products').select('org_id');
    check('sees no foreign site_products', (sp ?? []).every((x) => x.org_id === united.id));

    // Ranging is the first write path staff-facing UI exposes, and a Server Action is
    // reachable by direct POST — so the posted site_id must be rejected in the database,
    // not only by the application code that normally sets it.
    const { data: theirSite } = await admin
      .from('sites').select('id').eq('org_id', metro.id).limit(1).single();
    const { data: someProduct } = await admin.from('products').select('id').limit(1).single();

    const { error: rangeError } = await other.from('site_products').insert({
      org_id: metro.id,
      site_id: theirSite!.id,
      product_id: someProduct!.id,
      par_level: 99,
    });
    check('cannot range a product at another org\'s site', rangeError !== null,
      rangeError ? '' : 'insert unexpectedly succeeded');

    // Claiming your own org_id while pointing at their site must fail too — the policy
    // has to check the site, not just the org column the caller supplies.
    const { error: spoofError } = await other.from('site_products').insert({
      org_id: united.id,
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
      .from('sites').select('id, org_id').eq('org_id', metro.id).limit(1).single();
    const { data: theirSupplier } = await admin
      .from('suppliers').select('id').eq('org_id', metro.id).limit(1).single();
    const { data: product } = await admin.from('products').select('id').limit(1).single();

    // A delivery is the first thing staff create, and it carries both org_id and site_id.
    // Supplying someone else's pair must fail on the site, not merely on the org column.
    const { error: foreignDelivery } = await other.from('deliveries').insert({
      org_id: metro.id,
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
      org_id: metro.id,
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
    const unitedSites = new Set(
      (await other.from('sites').select('id')).data?.map((s) => s.id) ?? [],
    );
    check('every visible delivery line belongs to a site this tenant can see',
      (lines ?? []).every((l) => l.deliveries && unitedSites.has(l.deliveries.site_id)),
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

  console.log('\nmanagers review only their own site\'s deliveries:');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;
    const { count: coburgDeliveries } = await admin
      .from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', coburg.id);

    const brunswickManager = await signIn('manager@metro-petroleum.test');
    const { data: seenFromBrunswick } = await brunswickManager.from('deliveries').select('site_id');
    check('the Brunswick manager sees deliveries, all of them Brunswick\'s',
      (seenFromBrunswick?.length ?? 0) > 0 && seenFromBrunswick!.every((d) => d.site_id === brunswick.id),
      `saw ${seenFromBrunswick?.length} deliveries`);

    const coburgManager = await signIn('coburg.manager@metro-petroleum.test');
    const { data: seenFromCoburg } = await coburgManager.from('deliveries').select('site_id');
    check('the Coburg manager sees exactly Coburg\'s deliveries',
      (seenFromCoburg?.length ?? 0) === (coburgDeliveries ?? -1) && seenFromCoburg!.every((d) => d.site_id === coburg.id),
      `saw ${seenFromCoburg?.length} of ${coburgDeliveries}`);

    const { data: oneCoburg } = await admin.from('deliveries').select('id').eq('site_id', coburg.id).limit(1).single();
    const { data: lines } = await brunswickManager.from('delivery_lines').select('id').eq('delivery_id', oneCoburg!.id);
    check('nor the lines of another site\'s delivery', (lines?.length ?? 0) === 0, `saw ${lines?.length} lines`);
  }

  console.log('\nproducts added from a docket belong to that organisation:');
  {
    const { data: own, error: ownError } = await staff.from('products')
      .insert({ name: 'RLS Docket Only Product 250ml', org_id: metro.id, tracking_mode: 'batch' })
      .select('id').single();
    check('staff can add a product private to their organisation', !ownError && !!own, ownError?.message ?? '');

    const { data: seenByOther } = await other.from('products').select('id').eq('id', own?.id ?? '');
    check('another organisation cannot see it', (seenByOther?.length ?? 0) === 0,
      `saw ${seenByOther?.length} rows`);

    const { data: seenByOwner } = await staff.from('products').select('id').eq('id', own?.id ?? '');
    check('its own organisation can', seenByOwner?.length === 1);

    const { error: planted } = await other.from('products')
      .insert({ name: 'Planted product', org_id: metro.id, tracking_mode: 'batch' });
    check('cannot add a product into another organisation', planted !== null,
      planted ? '' : 'insert unexpectedly succeeded');

    const { data: madeShared } = await staff.from('products')
      .update({ org_id: united.id }).eq('id', own?.id ?? '').select('id');
    check('cannot move a private product into another organisation', (madeShared?.length ?? 0) === 0);

    const { data: shared } = await other.from('products').select('id').is('org_id', null).limit(1);
    check('the shared catalogue is still visible to everyone', (shared?.length ?? 0) === 1);

    if (own) await admin.from('products').delete().eq('id', own.id);
  }

  console.log('\nsuppliers recognised from dockets:');
  {
    // Staff add suppliers mid-delivery through add_supplier(); suppliers_insert still
    // stops them writing the table directly, so the function is the only way in.
    const { error: directSupplier } = await staff.from('suppliers')
      .insert({ org_id: metro.id, name: 'RLS direct supplier' });
    check('staff cannot insert a supplier directly', directSupplier !== null,
      directSupplier ? '' : 'insert unexpectedly succeeded');

    // Made up for this suite; cleared first in case an earlier run stopped part-way.
    const abn = '91999000111';
    await admin.from('suppliers').delete().eq('org_id', metro.id).or(`abn.eq.${abn},name.ilike.rls docket supplier`);
    const { data: added, error: addError } = await staff.rpc('add_supplier', {
      p_org_id: metro.id, p_name: 'RLS Docket Supplier', p_abn: abn,
    });
    const supplierId = added?.[0]?.supplier_id;
    check('staff can add a supplier to their own organisation',
      !addError && added?.[0]?.existing === false, addError?.message ?? '');

    const { data: sameName } = await staff.rpc('add_supplier', {
      p_org_id: metro.id, p_name: 'rls docket supplier', p_abn: null,
    });
    const { data: sameAbn } = await staff.rpc('add_supplier', {
      p_org_id: metro.id, p_name: 'Someone Else Entirely', p_abn: abn,
    });
    check('the same name or ABN returns the existing supplier, not a duplicate',
      sameName?.[0]?.supplier_id === supplierId && sameName?.[0]?.existing === true
        && sameAbn?.[0]?.supplier_id === supplierId && sameAbn?.[0]?.existing === true);

    const { error: foreignAdd } = await other.rpc('add_supplier', {
      p_org_id: metro.id, p_name: 'Planted supplier', p_abn: null,
    });
    check('cannot add a supplier to another organisation', foreignAdd !== null,
      foreignAdd ? '' : 'rpc unexpectedly succeeded');

    const archived = await signIn('owner@liberty-oil.test');
    const liberty = orgs!.find((o) => o.slug === 'liberty-oil')!;
    const { error: archivedAdd } = await archived.rpc('add_supplier', {
      p_org_id: liberty.id, p_name: 'After archive', p_abn: null,
    });
    check('an archived organisation cannot gain suppliers', archivedAdd !== null,
      archivedAdd ? '' : 'rpc unexpectedly succeeded');

    const { error: rememberError } = await staff.rpc('remember_supplier_docket', {
      p_supplier_id: supplierId!, p_alias: 'rls docket supplier wholesale', p_abn: null,
    });
    const { data: ownAliases } = await staff.from('supplier_aliases').select('alias').eq('supplier_id', supplierId!);
    check('staff can teach a supplier its docket name',
      !rememberError && ownAliases?.length === 1, rememberError?.message ?? `got ${ownAliases?.length}`);

    const { data: foreignAliases } = await other.from('supplier_aliases').select('org_id');
    check('sees no foreign supplier aliases', (foreignAliases ?? []).every((a) => a.org_id === united.id),
      `got ${foreignAliases?.length} aliases`);

    const { error: foreignRemember } = await other.rpc('remember_supplier_docket', {
      p_supplier_id: supplierId!, p_alias: 'hijacked name', p_abn: null,
    });
    check('cannot teach another organisation\'s supplier a name', foreignRemember !== null,
      foreignRemember ? '' : 'rpc unexpectedly succeeded');

    const { error: directAlias } = await staff.from('supplier_aliases')
      .insert({ org_id: metro.id, supplier_id: supplierId!, alias: 'direct alias' });
    check('aliases are only written through the function', directAlias !== null,
      directAlias ? '' : 'insert unexpectedly succeeded');

    await admin.from('suppliers').delete().eq('id', supplierId!);
  }

  console.log('\nsite timezones:');
  {
    // Even the service role, which skips RLS, cannot create a site without a real zone:
    // every date the site sees is worked out in it.
    const { error: madeUp } = await admin.from('sites')
      .insert({ org_id: metro.id, name: 'RLS zone check', timezone: 'Perth' });
    check('a made-up timezone is refused', madeUp !== null, madeUp ? '' : 'insert unexpectedly succeeded');

    const { error: missing } = await admin.from('sites')
      .insert({ org_id: metro.id, name: 'RLS zone check', timezone: null as unknown as string });
    check('a site needs a timezone (no silent Melbourne default)', missing !== null,
      missing ? '' : 'insert unexpectedly succeeded');
  }

  console.log('\nreminder settings and Today answers:');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;
    // Cleared first in case an earlier run stopped part-way.
    await admin.from('reminder_settings').delete().in('site_id', [brunswick.id, coburg.id]);

    const brunswickManager = await signIn('manager@metro-petroleum.test');
    const { error: ownSave } = await brunswickManager.from('reminder_settings')
      .insert({ site_id: brunswick.id, org_id: metro.id, short_max_days: 14 });
    check('a manager can save their own site\'s reminder settings', ownSave === null, ownSave?.message ?? '');

    const { error: otherSiteSave } = await brunswickManager.from('reminder_settings')
      .insert({ site_id: coburg.id, org_id: metro.id });
    check('but not another site\'s, even in the same organisation', otherSiteSave !== null,
      otherSiteSave ? '' : 'insert unexpectedly succeeded');

    const { data: staffEdit } = await staff.from('reminder_settings')
      .update({ short_max_days: 30 }).eq('site_id', brunswick.id).select('site_id');
    check('staff can read but not change them', (staffEdit?.length ?? 0) === 0,
      `updated ${staffEdit?.length} rows`);

    const { data: foreignSettings } = await other.from('reminder_settings').select('site_id').eq('site_id', brunswick.id);
    check('another organisation cannot see them', (foreignSettings?.length ?? 0) === 0);

    const { error: plantedSettings } = await other.from('reminder_settings')
      .insert({ site_id: coburg.id, org_id: united.id });
    check('nor file settings against a foreign site under its own org_id', plantedSettings !== null,
      plantedSettings ? '' : 'insert unexpectedly succeeded');

    // A Today answer closes a batch, so it must never reach another tenant's stock.
    const { data: theirBatch } = await admin.from('stock_batches')
      .select('id').eq('org_id', united.id).eq('status', 'active').limit(1).single();
    const { error: foreignAnswer } = await staff.rpc('resolve_batch_step', {
      p_batch_id: theirBatch!.id, p_step: 'sold',
    });
    const { data: stillActive } = await admin.from('stock_batches').select('status').eq('id', theirBatch!.id).single();
    check('cannot answer a reminder for another organisation\'s batch',
      foreignAnswer !== null && stillActive?.status === 'active',
      foreignAnswer ? '' : `rpc succeeded; batch is ${stillActive?.status}`);

    await admin.from('reminder_settings').delete().in('site_id', [brunswick.id, coburg.id]);
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
        p_owner_email: 'owner@united-petroleum.test',
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
      .insert({ org_id: cascadeOrg!.id, name: 'Cascade site', timezone: 'Australia/Melbourne' })
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
      .insert({ org_id: jobOrg!.id, name: 'Job site', timezone: 'Australia/Melbourne' })
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

    const { data: unitedSite } = await admin
      .from('sites')
      .select('id')
      .eq('org_id', united.id)
      .limit(1)
      .single();
    const { data: metroSite } = await admin
      .from('sites')
      .select('id')
      .eq('org_id', metro.id)
      .limit(1)
      .single();

    const { error: directSiteWrite } = await platform
      .from('sites')
      .insert({ org_id: united.id, name: 'Unaudited site', timezone: 'Australia/Melbourne' });
    check('platform admin cannot bypass audited site creation',
      directSiteWrite !== null, directSiteWrite ? '' : 'insert unexpectedly succeeded');

    const { data: directSiteUpdate } = await platform
      .from('sites')
      .update({ name: 'Unaudited rename' })
      .eq('id', unitedSite!.id)
      .select('id');
    check('platform admin cannot bypass audited site updates',
      (directSiteUpdate?.length ?? 0) === 0, `updated ${directSiteUpdate?.length} sites`);

    const { error: directMembershipInsert } = await platform.from('memberships').insert({
      org_id: united.id,
      user_id: platformUser!.id,
      site_id: null,
      role: 'owner',
    });
    check('platform admin cannot bypass audited membership creation',
      directMembershipInsert !== null, directMembershipInsert ? '' : 'insert unexpectedly succeeded');

    const { data: rpcSite, error: rpcSiteError } = await platform.rpc('create_organisation_site', {
      p_org_id: united.id,
      p_name: 'RPC lifecycle site',
      p_timezone: 'Australia/Melbourne',
      p_address: null,
    });
    check('platform admin can create a site through the audited RPC',
      rpcSiteError === null && Boolean(rpcSite), rpcSiteError?.message ?? '');

    const { data: rpcMembership, error: rpcMembershipError } = await platform.rpc(
      'add_organisation_member',
      {
        p_org_id: united.id,
        p_user_id: otherUser!.id,
        p_site_id: rpcSite!,
        p_role: 'manager',
        p_email: 'owner@united-petroleum.test',
      },
    );
    check('platform admin can add a member through the audited RPC',
      rpcMembershipError === null && Boolean(rpcMembership), rpcMembershipError?.message ?? '');

    const { data: orgWideMembership, error: orgWideMembershipError } = await platform.rpc(
      'add_organisation_member',
      {
        p_org_id: united.id,
        p_user_id: platformUser!.id,
        p_site_id: null,
        p_role: 'owner',
        p_email: 'admin@shelflife.test',
      },
    );
    check('organisation-wide membership RPC accepts an explicit null site',
      orgWideMembershipError === null && Boolean(orgWideMembership),
      orgWideMembershipError?.message ?? '');

    // NULL site_ids must collide: unique nulls not distinct (user_id, org_id, site_id).
    const { error: duplicateOrgWideError } = await platform.rpc('add_organisation_member', {
      p_org_id: united.id,
      p_user_id: platformUser!.id,
      p_site_id: null,
      p_role: 'owner',
      p_email: 'admin@shelflife.test',
    });
    check('duplicate organisation-wide membership is a unique violation',
      duplicateOrgWideError?.code === '23505',
      duplicateOrgWideError ? `got ${duplicateOrgWideError.code}` : 'insert unexpectedly succeeded');
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
        org_id: united.id,
        site_id: metroSite!.id,
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
        org_id: united.id,
        site_id: unitedSite!.id,
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
        org_id: united.id,
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
      org_id: metro.id,
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
        org_id: metro.id,
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
      .update({ site_id: metroSite!.id })
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
      .eq('id', united.id)
      .select('id');
    check('owner cannot change organisation lifecycle',
      (ownerMutation?.length ?? 0) === 0, `updated ${ownerMutation?.length} rows`);

    const { data: deleted } = await platform
      .from('orgs')
      .delete()
      .eq('id', united.id)
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
      .eq('id', united.id)
      .select('id');
    check('platform admin cannot bypass audited lifecycle RPCs',
      (directAdminMutation?.length ?? 0) === 0,
      `updated ${directAdminMutation?.length} rows`);

    const { error: archiveError } = await platform.rpc('archive_organisation', {
      p_org_id: united.id,
      p_confirm_slug: ORG_B_SLUG,
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
      .insert({ org_id: united.id, name: 'Post-archive service write', timezone: 'Australia/Melbourne' });
    check('service role cannot add a site after archival', archivedServiceWrite !== null,
      archivedServiceWrite ? '' : 'insert unexpectedly succeeded');

    const { error: forgedAudit } = await other.rpc('write_audit', {
      p_action: 'platform_admin.forged',
      p_org_id: metro.id,
      p_subject_type: 'org',
      p_subject_id: metro.id,
    });
    check('non-admin cannot forge platform audit entries', forgedAudit !== null,
      forgedAudit ? '' : 'audit write unexpectedly succeeded');

    const { data: adminView } = await platform
      .from('orgs')
      .select('status')
      .eq('id', united.id)
      .single();
    check('platform admin can inspect an archived organisation',
      adminView?.status === 'archived', `got ${adminView?.status}`);

    const { error: restoreError } = await platform.rpc('restore_organisation', {
      p_org_id: united.id,
    });
    check('platform admin can restore through the audited RPC', restoreError === null,
      restoreError?.message ?? '');

    const { data: restored } = await other.from('orgs').select('id');
    check('owner access returns after restore',
      restored?.length === 1 && restored[0].id === united.id,
      `got ${restored?.length} orgs`);

    await other.from('push_subscriptions').delete().eq('id', subscription!.id);

    await admin.from('orgs').update({ is_demo: true }).eq('id', united.id);
    const { error: demoAuditError } = await other.rpc('write_audit', {
      p_action: 'demo.jump_days',
      p_org_id: united.id,
      p_subject_type: 'org',
      p_subject_id: united.id,
      p_detail: { days: 7, test: true },
    });
    check('authorised demo audit events remain available', demoAuditError === null,
      demoAuditError?.message ?? '');
    await admin.from('orgs').update({ is_demo: false }).eq('id', united.id);
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

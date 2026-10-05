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

  console.log('\nmanagers correct closed deliveries and review docket products:');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const { data: supplier } = await admin.from('suppliers').select('id').eq('org_id', metro.id).limit(1).single();
    const closedAt = '2026-09-01T03:00:00Z';

    const { data: products } = await admin.from('products').insert([
      { name: 'RLS Correction Milk 2L', org_id: metro.id, tracking_mode: 'batch' },
      { name: 'RLS Correction Chips 175g', org_id: metro.id, tracking_mode: 'rotation' },
      { name: 'RLS Correction Yoghurt 1kg', org_id: metro.id, tracking_mode: 'batch' },
    ]).select('id, name');
    const milk = products!.find((p) => p.name.includes('Milk'))!;
    const chips = products!.find((p) => p.name.includes('Chips'))!;
    const yoghurt = products!.find((p) => p.name.includes('Yoghurt'))!;

    const { data: delivery } = await admin.from('deliveries').insert({
      org_id: metro.id, site_id: brunswick.id, supplier_id: supplier!.id,
      status: 'closed', received_at: closedAt, closed_at: closedAt,
    }).select('id').single();
    const { data: lines } = await admin.from('delivery_lines').insert([
      { org_id: metro.id, delivery_id: delivery!.id, product_id: milk.id, qty_docketed: 12, qty_received: 12 },
      { org_id: metro.id, delivery_id: delivery!.id, product_id: chips.id, qty_docketed: 6, qty_received: 6 },
      { org_id: metro.id, delivery_id: delivery!.id, product_id: yoghurt.id, qty_docketed: 4, qty_received: 4 },
    ]).select('id, product_id');
    const milkLine = lines!.find((l) => l.product_id === milk.id)!;
    const chipsLine = lines!.find((l) => l.product_id === chips.id)!;
    const yoghurtLine = lines!.find((l) => l.product_id === yoghurt.id)!;
    const { data: batches } = await admin.from('stock_batches').insert([
      { org_id: metro.id, site_id: brunswick.id, product_id: milk.id, delivery_line_id: milkLine.id,
        expiry_date: '2026-09-10', qty_received: 12, qty_remaining: 12, created_at: closedAt },
      { org_id: metro.id, site_id: brunswick.id, product_id: yoghurt.id, delivery_line_id: yoghurtLine.id,
        expiry_date: '2026-09-20', qty_received: 4, qty_remaining: 4, created_at: closedAt },
    ]).select('id, product_id');
    const milkBatch = batches!.find((b) => b.product_id === milk.id)!;
    const yoghurtBatch = batches!.find((b) => b.product_id === yoghurt.id)!;
    await admin.from('expiry_actions').insert({
      org_id: metro.id, site_id: brunswick.id, batch_id: milkBatch.id, action: 'pull', due_date: '2026-09-10',
    });

    type Dated = { id: string | null; expiry_date: string; qty: number };
    const fix = (db: Db, qtyDocketed: number, qtyReceived: number, batches: Dated[], lineId = milkLine.id) =>
      db.rpc('correct_delivery_line', {
        p_line_id: lineId, p_qty_docketed: qtyDocketed, p_qty_received: qtyReceived, p_batches: batches,
      });

    const brunswickManager = await signIn('manager@metro-petroleum.test');
    const coburgManager = await signIn('coburg.manager@metro-petroleum.test');
    const { data: managerUser } = await brunswickManager.auth.getUser();

    const { error: byStaff } = await fix(staff, 12, 10, []);
    check('staff cannot correct a closed delivery', byStaff?.code === '42501', byStaff?.message ?? 'no error');
    const { error: byCoburg } = await fix(coburgManager, 12, 10, []);
    check('a manager of another site cannot correct it', byCoburg?.code === '42501', byCoburg?.message ?? 'no error');
    const { error: byOther } = await fix(other, 12, 10, []);
    check('another organisation cannot correct it', byOther !== null, 'correction unexpectedly succeeded');

    const { error: corrected } = await fix(brunswickManager, 12, 10, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 10 }]);
    check('the site\'s manager corrects the count and the date', corrected === null, corrected?.message ?? '');
    const { data: lineAfter } = await admin.from('delivery_lines')
      .select('qty_received, staff_qty_received, staff_qty_docketed, corrected_by, corrected_at').eq('id', milkLine.id).single();
    check('the line keeps what staff first entered beside the correction',
      lineAfter?.qty_received === 10 && lineAfter.staff_qty_received === 12 && lineAfter.staff_qty_docketed === 12
        && lineAfter.corrected_by === managerUser.user?.id && lineAfter.corrected_at !== null,
      JSON.stringify(lineAfter));
    const { data: batchAfter } = await admin.from('stock_batches')
      .select('qty_received, qty_remaining, expiry_date, expiry_source, status').eq('id', milkBatch.id).single();
    check('the batch moves with it and its date is marked as typed in',
      batchAfter?.qty_received === 10 && batchAfter.qty_remaining === 10 && batchAfter.expiry_date === '2026-09-12'
        && batchAfter.expiry_source === 'manual' && batchAfter.status === 'active',
      JSON.stringify(batchAfter));
    const { count: openActions } = await admin.from('expiry_actions')
      .select('*', { count: 'exact', head: true }).eq('batch_id', milkBatch.id).eq('state', 'open');
    check('the reminder planned from the old date is cleared', openActions === 0, `${openActions} open`);
    const { data: audit } = await admin.from('audit_log').select('actor_id, detail')
      .eq('action', 'delivery.line_corrected').eq('subject_id', milkLine.id);
    check('the correction is in the audit log', audit?.length === 1 && audit[0].actor_id === managerUser.user?.id,
      `got ${audit?.length}`);

    const { data: lineAgain } = await admin.from('delivery_lines').select('staff_qty_received').eq('id', milkLine.id).single();
    await fix(brunswickManager, 12, 11, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 11 }]);
    const { data: secondFix } = await admin.from('delivery_lines').select('staff_qty_received').eq('id', milkLine.id).single();
    check('a second correction still remembers staff\'s figure, not the first correction',
      lineAgain?.staff_qty_received === 12 && secondFix?.staff_qty_received === 12, JSON.stringify(secondFix));

    // Staff wrote off 7 since.
    await admin.from('stock_batches').update({ qty_remaining: 4 }).eq('id', milkBatch.id);
    const { error: belowUsed } = await fix(brunswickManager, 12, 5, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 5 }]);
    check('cannot un-receive stock already written off', belowUsed?.code === '23514', belowUsed?.message ?? 'no error');
    const { error: dropUsed } = await fix(brunswickManager, 12, 11, []);
    check('nor remove a batch staff already acted on', dropUsed?.code === '23514', dropUsed?.message ?? 'no error');
    await fix(brunswickManager, 12, 7, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 7 }]);
    const { data: emptied } = await admin.from('stock_batches').select('qty_remaining, status').eq('id', milkBatch.id).single();
    check('down to exactly what left, the batch holds nothing',
      emptied?.qty_remaining === 0 && emptied.status === 'active', JSON.stringify(emptied));
    await fix(brunswickManager, 12, 12, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 12 }]);
    const { data: refilled } = await admin.from('stock_batches').select('qty_remaining, status').eq('id', milkBatch.id).single();
    check('raised again, it is back on the shelf', refilled?.qty_remaining === 5 && refilled.status === 'active',
      JSON.stringify(refilled));

    // Staff pulled the rest: raising the count must not put stock back on a cleared shelf.
    await admin.from('stock_batches').update({ qty_remaining: 0, status: 'pulled' }).eq('id', milkBatch.id);
    await fix(brunswickManager, 13, 13, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 13 }]);
    const { data: stillPulled } = await admin.from('stock_batches').select('qty_received, qty_remaining, status').eq('id', milkBatch.id).single();
    check('a batch staff pulled stays empty when its count is raised',
      stillPulled?.qty_received === 13 && stillPulled.qty_remaining === 0 && stillPulled.status === 'pulled',
      JSON.stringify(stillPulled));
    await admin.from('stock_batches').update({ qty_remaining: 5, status: 'active' }).eq('id', milkBatch.id);
    await fix(brunswickManager, 12, 12, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 12 }]);

    const { error: tooMany } = await fix(brunswickManager, 12, 12,
      [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 12 }, { id: null, expiry_date: '2026-09-14', qty: 2 }]);
    check('dates cannot cover more than arrived', tooMany?.code === '23514', tooMany?.message ?? 'no error');
    const { error: added } = await fix(brunswickManager, 14, 14,
      [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 12 }, { id: null, expiry_date: '2026-09-14', qty: 2 }]);
    const { data: newBatch } = await admin.from('stock_batches').select('created_at, expiry_source')
      .eq('delivery_line_id', milkLine.id).eq('expiry_date', '2026-09-14').maybeSingle();
    check('a new date arrives on the delivery\'s day, not today',
      added === null && newBatch !== null && new Date(newBatch.created_at).toISOString() === new Date(closedAt).toISOString(),
      added?.message ?? JSON.stringify(newBatch));

    const { error: datedRotation } = await fix(brunswickManager, 6, 6, [{ id: null, expiry_date: '2026-09-14', qty: 6 }], chipsLine.id);
    check('rotation stock carries no dates', datedRotation?.code === '23514', datedRotation?.message ?? 'no error');
    const { error: removed } = await fix(brunswickManager, 0, 0, [], chipsLine.id);
    const { data: chipsGone } = await admin.from('delivery_lines').select('id').eq('id', chipsLine.id);
    check('zero docketed and received removes the line', removed === null && chipsGone?.length === 0, removed?.message ?? '');

    await admin.from('deliveries').update({ status: 'draft' }).eq('id', delivery!.id);
    const { error: stillOpen } = await fix(brunswickManager, 12, 12, [{ id: milkBatch.id, expiry_date: '2026-09-12', qty: 12 }]);
    check('an open delivery is still staff\'s to finish', stillOpen?.code === '23514', stillOpen?.message ?? 'no error');
    await admin.from('deliveries').update({ status: 'closed' }).eq('id', delivery!.id);

    const review = (db: Db, productId: string, mode: 'batch' | 'rotation' | 'none', fixture: string | null, barcode: string | null = null) =>
      db.rpc('review_docket_product', {
        p_product_id: productId, p_site_id: brunswick.id, p_name: 'RLS Reviewed Name', p_brand: null, p_size: null,
        p_barcode: barcode, p_tracking_mode: mode, p_shelf_life_days: null, p_fixture: fixture,
      });

    const { error: staffReview } = await review(staff, yoghurt.id, 'batch', null);
    check('staff cannot review a docket product', staffReview?.code === '42501', staffReview?.message ?? 'no error');
    const { error: coburgReview } = await review(coburgManager, yoghurt.id, 'batch', null);
    check('nor a manager of another site, for this site', coburgReview?.code === '42501', coburgReview?.message ?? 'no error');
    const { data: sharedProduct } = await admin.from('products').select('id, barcode').is('org_id', null).not('barcode', 'is', null).limit(1).single();
    const { error: sharedReview } = await review(brunswickManager, sharedProduct!.id, 'none', null);
    check('the shared catalogue is not a manager\'s to change', sharedReview?.code === '42501', sharedReview?.message ?? 'no error');
    const { error: noFixture } = await review(brunswickManager, yoghurt.id, 'rotation', null);
    check('rotation cannot be chosen without a fixture', noFixture?.code === '23514', noFixture?.message ?? 'no error');
    const { error: taken } = await review(brunswickManager, yoghurt.id, 'batch', null, sharedProduct!.barcode);
    check('a barcode already in the catalogue is refused', taken?.code === '23505', taken?.message ?? 'no error');

    const { data: offBoard, error: reviewed } = await review(brunswickManager, yoghurt.id, 'rotation', 'Dairy fridge');
    const [{ data: yoghurtAfter }, { data: ranged }, { data: yoghurtBatches }] = await Promise.all([
      admin.from('products').select('name, tracking_mode, reviewed_at').eq('id', yoghurt.id).single(),
      admin.from('site_products').select('fixture').eq('site_id', brunswick.id).eq('product_id', yoghurt.id).maybeSingle(),
      admin.from('stock_batches').select('id').eq('id', yoghurtBatch.id),
    ]);
    check('the manager reviews it: renamed, rotation, on a fixture',
      reviewed === null && yoghurtAfter?.name === 'RLS Reviewed Name' && yoghurtAfter.tracking_mode === 'rotation'
        && yoghurtAfter.reviewed_at !== null && ranged?.fixture === 'Dairy fridge',
      reviewed?.message ?? JSON.stringify({ yoghurtAfter, ranged }));
    check('its untouched dated stock leaves the expiry board', offBoard === 1 && yoghurtBatches?.length === 0,
      `offBoard ${offBoard}, ${yoghurtBatches?.length} batches left`);

    // Milk has stock staff already acted on: it is closed out, not deleted.
    const { data: milkOff } = await review(brunswickManager, milk.id, 'none', null);
    const { data: milkBatches } = await admin.from('stock_batches').select('status, qty_remaining').eq('product_id', milk.id);
    check('dated stock staff acted on is closed out, not erased',
      milkOff === 2 && milkBatches?.some((b) => b.status === 'sold_through' && b.qty_remaining === 0) === true
        && (milkBatches?.length ?? 0) === 1,
      `offBoard ${milkOff}, ${JSON.stringify(milkBatches)}`);

    const { error: undatedFix } = await fix(brunswickManager, 14, 13, []);
    check('a line whose product is no longer dated can still be corrected', undatedFix === null, undatedFix?.message ?? '');
    const { error: keptLine } = await fix(brunswickManager, 0, 0, []);
    check('but not removed while stock from it has left the shelf', keptLine?.code === '23514', keptLine?.message ?? 'no error');

    // Tracking is the product's, so a site the caller does not run blocks the change.
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;
    const { data: juice } = await admin.from('products')
      .insert({ name: 'RLS Correction Juice 1L', org_id: metro.id, tracking_mode: 'batch' }).select('id').single();
    const { data: coburgDelivery } = await admin.from('deliveries').insert({
      org_id: metro.id, site_id: coburg.id, supplier_id: supplier!.id, status: 'closed', received_at: closedAt, closed_at: closedAt,
    }).select('id').single();
    const { data: coburgLine } = await admin.from('delivery_lines').insert({
      org_id: metro.id, delivery_id: coburgDelivery!.id, product_id: juice!.id, qty_docketed: 3, qty_received: 3,
    }).select('id').single();
    await admin.from('stock_batches').insert({
      org_id: metro.id, site_id: coburg.id, product_id: juice!.id, delivery_line_id: coburgLine!.id,
      expiry_date: '2026-09-20', qty_received: 3, qty_remaining: 3, created_at: closedAt,
    });
    const { error: elsewhere } = await review(brunswickManager, juice!.id, 'none', null);
    check('a manager cannot change tracking for a product another site receives', elsewhere?.code === '42501',
      elsewhere?.message ?? 'no error');
    const { error: sameMode } = await review(brunswickManager, juice!.id, 'batch', null);
    check('but can still review its details', sameMode === null, sameMode?.message ?? '');

    const { error: unfixed } = await review(owner, juice!.id, 'rotation', 'Juice fridge');
    check('rotation waits for a fixture at every site that receives it', unfixed?.code === '23514', unfixed?.message ?? 'no error');
    await admin.from('site_products').insert({ org_id: metro.id, site_id: coburg.id, product_id: juice!.id, fixture: 'Cold room' });
    const { data: juiceOff, error: ownerReview } = await review(owner, juice!.id, 'rotation', 'Juice fridge');
    const { count: coburgLive } = await admin.from('stock_batches')
      .select('*', { count: 'exact', head: true }).eq('product_id', juice!.id).eq('status', 'active');
    check('the owner switches it, and every site\'s dated stock leaves the board',
      ownerReview === null && juiceOff === 1 && coburgLive === 0, ownerReview?.message ?? `offBoard ${juiceOff}, ${coburgLive} live`);

    await admin.from('stock_batches').delete().in('product_id', [milk.id, chips.id, yoghurt.id, juice!.id]);
    await admin.from('deliveries').delete().in('id', [delivery!.id, coburgDelivery!.id]);
    await admin.from('products').delete().in('id', [milk.id, chips.id, yoghurt.id, juice!.id]);
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

  console.log('\nsupplier upkeep (rename, switch off, merge):');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;
    const { data: made } = await admin.from('suppliers').insert([
      { org_id: metro.id, name: 'RLS Upkeep CCEP Pty Ltd', abn: '90000000001' },
      { org_id: metro.id, name: 'RLS Upkeep Coca-Cola' },
      { org_id: metro.id, name: 'RLS Upkeep Lion', abn: '90000000002' },
    ]).select('id, name');
    const ccep = made!.find((s) => s.name.includes('CCEP'))!;
    const coke = made!.find((s) => s.name.includes('Coca'))!;
    const lion = made!.find((s) => s.name.includes('Lion'))!;
    await admin.from('supplier_aliases').insert({ org_id: metro.id, supplier_id: ccep.id, alias: 'rls upkeep ccep printed' });
    const delivered = (siteId: string, supplierId: string) => ({
      org_id: metro.id, site_id: siteId, supplier_id: supplierId, status: 'closed' as const,
      received_at: '2026-09-02T03:00:00Z', closed_at: '2026-09-02T03:00:00Z',
    });
    await admin.from('deliveries').insert([delivered(brunswick.id, ccep.id), delivered(coburg.id, ccep.id), delivered(brunswick.id, coke.id)]);

    const edit = (db: Db, supplierId: string, name: string, abn: string | null, active = true, alias: string | null = null) =>
      db.rpc('update_supplier', { p_supplier_id: supplierId, p_name: name, p_abn: abn, p_active: active, p_old_alias: alias });
    const brunswickManager = await signIn('manager@metro-petroleum.test');
    const coburgManager = await signIn('coburg.manager@metro-petroleum.test');

    const { error: byStaff } = await edit(staff, lion.id, 'RLS Upkeep Lion Dairy', '90000000002');
    check('staff cannot change a supplier', byStaff?.code === '42501', byStaff?.message ?? 'no error');
    const { error: byOther } = await edit(other, lion.id, 'RLS Upkeep Lion Dairy', '90000000002');
    check('another organisation cannot', byOther?.code === '42501', byOther?.message ?? 'no error');

    const { error: renamed } = await edit(brunswickManager, lion.id, 'RLS Upkeep Lion Dairy', '90000000002', true, 'rls upkeep lion');
    const { data: lionAliases } = await admin.from('supplier_aliases').select('alias').eq('supplier_id', lion.id);
    check('a manager renames it, and the old name stays recognised on dockets',
      renamed === null && lionAliases?.some((a) => a.alias === 'rls upkeep lion') === true,
      renamed?.message ?? JSON.stringify(lionAliases));
    const { error: sameName } = await edit(brunswickManager, lion.id, 'rls upkeep coca-cola', '90000000002');
    check('a name another supplier has, in any case, is refused', sameName?.code === '23505', sameName?.message ?? 'no error');
    const { error: sameAbn } = await edit(brunswickManager, lion.id, 'RLS Upkeep Lion Dairy', '90000000001');
    check('so is another supplier\'s ABN', sameAbn?.code === '23505', sameAbn?.message ?? 'no error');
    const { error: off } = await edit(brunswickManager, lion.id, 'RLS Upkeep Lion Dairy', '90000000002', false);
    const { data: lionAfter } = await admin.from('suppliers').select('active').eq('id', lion.id).single();
    check('a manager switches a supplier off', off === null && lionAfter?.active === false, off?.message ?? '');

    const { data: fromCoburg } = await coburgManager.rpc('supplier_activity', { p_org_id: metro.id });
    const { data: fromOwner } = await owner.rpc('supplier_activity', { p_org_id: metro.id });
    check('delivery counts follow the sites someone runs',
      fromCoburg?.find((a) => a.supplier_id === ccep.id)?.deliveries === 1
        && fromOwner?.find((a) => a.supplier_id === ccep.id)?.deliveries === 2,
      JSON.stringify({ coburg: fromCoburg?.find((a) => a.supplier_id === ccep.id), owner: fromOwner?.find((a) => a.supplier_id === ccep.id) }));

    const merge = (db: Db, keep: string, remove: string, alias: string | null = null) =>
      db.rpc('merge_suppliers', { p_keep_id: keep, p_remove_id: remove, p_alias: alias });
    const { error: managerMerge } = await merge(brunswickManager, coke.id, ccep.id);
    check('a manager cannot merge suppliers', managerMerge?.code === '42501', managerMerge?.message ?? 'no error');
    const { error: otherMerge } = await merge(other, coke.id, ccep.id);
    check('nor can another organisation', otherMerge?.code === '42501', otherMerge?.message ?? 'no error');
    const { error: twoAbns } = await merge(owner, lion.id, ccep.id);
    check('two different ABNs are two businesses: refused', twoAbns?.code === '23514', twoAbns?.message ?? 'no error');

    await admin.from('suppliers').update({ active: false }).eq('id', coke.id);
    const { data: moved, error: merged } = await merge(owner, coke.id, ccep.id, 'rls upkeep ccep');
    const [{ data: gone }, { data: kept }, { count: keptDeliveries }, { data: keptAliases }, { data: mergeAudit }] = await Promise.all([
      admin.from('suppliers').select('id').eq('id', ccep.id),
      admin.from('suppliers').select('abn, active').eq('id', coke.id).single(),
      admin.from('deliveries').select('*', { count: 'exact', head: true }).eq('supplier_id', coke.id),
      admin.from('supplier_aliases').select('alias').eq('supplier_id', coke.id),
      admin.from('audit_log').select('id').eq('action', 'supplier.merged').eq('subject_id', coke.id),
    ]);
    check('the owner merges a duplicate: its deliveries move and it is gone',
      merged === null && moved === 2 && gone?.length === 0 && keptDeliveries === 3, merged?.message ?? `moved ${moved}, kept ${keptDeliveries}`);
    check('its docket names and its own name now recognise the kept supplier',
      ['rls upkeep ccep printed', 'rls upkeep ccep'].every((a) => keptAliases?.some((k) => k.alias === a)),
      JSON.stringify(keptAliases));
    check('the kept supplier takes its ABN and is switched back on',
      kept?.abn === '90000000001' && kept.active === true, JSON.stringify(kept));
    check('the merge is in the audit log', mergeAudit?.length === 1);

    await admin.from('deliveries').delete().in('supplier_id', [ccep.id, coke.id, lion.id]);
    await admin.from('suppliers').delete().in('id', [ccep.id, coke.id, lion.id]);
    await admin.from('audit_log').delete().in('subject_id', [ccep.id, coke.id, lion.id]);
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

  console.log('\nsite messages:');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;
    const preston = await signIn('preston.staff@metro-petroleum.test');
    const { data: { user: staffUser } } = await staff.auth.getUser();
    const { data: { user: prestonUser } } = await preston.auth.getUser();
    // Cleared first in case an earlier run stopped part-way.
    await admin.from('site_messages').delete().in('site_id', [brunswick.id, coburg.id]);

    const brunswickManager = await signIn('manager@metro-petroleum.test');
    const { data: { user: managerUser } } = await brunswickManager.auth.getUser();
    const { data: sent, error: sendError } = await brunswickManager.from('site_messages')
      .insert({ org_id: metro.id, site_id: brunswick.id, body: 'RLS check: fridge 3 off at 2pm', sent_by: managerUser!.id })
      .select('id').single();
    check('a manager can message their own site\'s staff', sendError === null && !!sent, sendError?.message ?? '');

    const { error: otherSite } = await brunswickManager.from('site_messages')
      .insert({ org_id: metro.id, site_id: coburg.id, body: 'RLS check', sent_by: managerUser!.id });
    check('but not another site\'s, even in the same organisation', otherSite !== null,
      otherSite ? '' : 'insert unexpectedly succeeded');

    const { error: forged } = await brunswickManager.from('site_messages')
      .insert({ org_id: metro.id, site_id: brunswick.id, body: 'RLS check', sent_by: staffUser!.id });
    check('nor send one in someone else\'s name', forged !== null, forged ? '' : 'insert unexpectedly succeeded');

    const { error: blank } = await brunswickManager.from('site_messages')
      .insert({ org_id: metro.id, site_id: brunswick.id, body: '   ', sent_by: managerUser!.id });
    check('an empty message is refused by the table', blank !== null, blank ? '' : 'insert unexpectedly succeeded');

    const { error: staffSend } = await staff.from('site_messages')
      .insert({ org_id: metro.id, site_id: brunswick.id, body: 'RLS check', sent_by: staffUser!.id });
    check('staff cannot send messages', staffSend !== null, staffSend ? '' : 'insert unexpectedly succeeded');

    const { data: staffSees } = await staff.from('site_messages').select('id').eq('id', sent!.id);
    check('staff at the site can read it', staffSees?.length === 1);

    const { data: prestonSees } = await preston.from('site_messages').select('id').eq('id', sent!.id);
    check('staff at another site cannot', (prestonSees?.length ?? 0) === 0, `saw ${prestonSees?.length}`);

    const { data: foreignSees } = await other.from('site_messages').select('id').eq('id', sent!.id);
    check('another organisation cannot see it', (foreignSees?.length ?? 0) === 0);

    const { error: planted } = await other.from('site_messages')
      .insert({ org_id: united.id, site_id: brunswick.id, body: 'RLS check', sent_by: managerUser!.id });
    check('nor plant a message at a foreign site under its own org_id', planted !== null,
      planted ? '' : 'insert unexpectedly succeeded');

    const { error: ack } = await staff.from('site_message_reads')
      .insert({ message_id: sent!.id, user_id: staffUser!.id });
    check('staff can mark it read for themselves', ack === null, ack?.message ?? '');

    const { error: ackTwice } = await staff.from('site_message_reads')
      .upsert({ message_id: sent!.id, user_id: staffUser!.id }, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
    check('marking it read twice is harmless', ackTwice === null, ackTwice?.message ?? '');

    const { error: ackForOther } = await staff.from('site_message_reads')
      .insert({ message_id: sent!.id, user_id: prestonUser!.id });
    check('but not for someone else', ackForOther !== null, ackForOther ? '' : 'insert unexpectedly succeeded');

    const { error: ackUnseen } = await preston.from('site_message_reads')
      .insert({ message_id: sent!.id, user_id: prestonUser!.id });
    check('nor read a message they cannot see', ackUnseen !== null, ackUnseen ? '' : 'insert unexpectedly succeeded');

    const { data: managerReads } = await brunswickManager.from('site_message_reads')
      .select('user_id').eq('message_id', sent!.id);
    check('the manager sees who has read it', managerReads?.length === 1 && managerReads[0].user_id === staffUser!.id,
      `got ${JSON.stringify(managerReads)}`);

    // A second staff member at Brunswick reads it too; the first must not see that.
    await admin.from('site_message_reads').insert({ message_id: sent!.id, user_id: managerUser!.id });
    const { data: staffReads } = await staff.from('site_message_reads').select('user_id').eq('message_id', sent!.id);
    check('staff see only their own read, not anyone else\'s',
      staffReads?.length === 1 && staffReads[0].user_id === staffUser!.id, `got ${staffReads?.length}`);

    const { data: staffDelete } = await staff.from('site_messages').delete().eq('id', sent!.id).select('id');
    check('staff cannot delete a message', (staffDelete?.length ?? 0) === 0, `deleted ${staffDelete?.length}`);

    const { data: managerDelete } = await brunswickManager.from('site_messages').delete().eq('id', sent!.id).select('id');
    const { count: readsLeft } = await admin.from('site_message_reads')
      .select('*', { count: 'exact', head: true }).eq('message_id', sent!.id);
    check('the manager can delete it, and its reads go with it',
      managerDelete?.length === 1 && readsLeft === 0, `deleted ${managerDelete?.length}, ${readsLeft} reads left`);

    const archived = await signIn('owner@liberty-oil.test');
    const { data: { user: archivedUser } } = await archived.auth.getUser();
    const { data: libertySite } = await admin.from('sites').select('id, org_id')
      .eq('org_id', orgs!.find((o) => o.slug === 'liberty-oil')!.id).limit(1).single();
    const { error: archivedSend } = await archived.from('site_messages')
      .insert({ org_id: libertySite!.org_id, site_id: libertySite!.id, body: 'RLS check', sent_by: archivedUser!.id });
    check('an archived organisation cannot send messages', archivedSend !== null,
      archivedSend ? '' : 'insert unexpectedly succeeded');
    // RLS already hides Liberty's sites from its owner; the trigger must refuse even the service role.
    const { error: archivedTrigger } = await admin.from('site_messages')
      .insert({ org_id: libertySite!.org_id, site_id: libertySite!.id, body: 'RLS check', sent_by: null });
    check('and the archive guard refuses it even past RLS', archivedTrigger !== null,
      archivedTrigger ? '' : 'insert unexpectedly succeeded');

    await admin.from('site_messages').delete().in('site_id', [brunswick.id, coburg.id]);
  }

  console.log('\nowners and managers manage their own people:');
  {
    const { data: metroSites } = await admin.from('sites').select('id, name').eq('org_id', metro.id);
    const brunswick = metroSites!.find((x) => x.name === 'Brunswick')!;
    const coburg = metroSites!.find((x) => x.name === 'Coburg')!;

    // Fresh logins for the run, removed again at the end so db:reset stays the same.
    const made: string[] = [];
    async function newLogin(tag: string): Promise<string> {
      const email = `rls-people-${tag}@shelflife.test`;
      const existing = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
      if (existing) await admin.auth.admin.deleteUser(existing.id);
      const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error) throw new Error(`could not create ${email}: ${error.message}`);
      made.push(data.user.id);
      return data.user.id;
    }
    const add = (db: Db, userId: string, siteId: string, role: 'staff' | 'manager' | 'owner') =>
      db.rpc('add_site_member', { p_user_id: userId, p_site_id: siteId, p_role: role, p_email: 'rls@shelflife.test' });

    const manager = await signIn('manager@metro-petroleum.test');
    const { data: { user: managerUser } } = await manager.auth.getUser();
    const newStaff = await newLogin('staff');
    const hopeful = await newLogin('hopeful');

    const { error: managerAddsStaff } = await add(manager, newStaff, brunswick.id, 'staff');
    check('a manager can add staff to their own site', managerAddsStaff === null, managerAddsStaff?.message ?? '');

    const { data: added } = await admin.from('audit_log').select('actor_id, site_id')
      .eq('action', 'member.added').eq('detail->>role', 'staff').eq('site_id', brunswick.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    check('and it is in the audit log under their name', added?.actor_id === managerUser!.id,
      `got ${JSON.stringify(added)}`);

    const { error: twice } = await add(manager, newStaff, brunswick.id, 'staff');
    check('adding the same person twice is refused', twice?.code === '23505', twice?.code ?? 'no error');

    const { error: managerAddsManager } = await add(manager, hopeful, brunswick.id, 'manager');
    check('a manager cannot add a manager', managerAddsManager !== null, managerAddsManager ? '' : 'rpc succeeded');

    const { error: otherSite } = await add(manager, hopeful, coburg.id, 'staff');
    check('nor add staff at another site', otherSite !== null, otherSite ? '' : 'rpc succeeded');

    const { error: staffAdds } = await add(staff, hopeful, brunswick.id, 'staff');
    check('staff cannot add anyone', staffAdds !== null, staffAdds ? '' : 'rpc succeeded');

    const { error: ownerAddsOwner } = await add(owner, hopeful, brunswick.id, 'owner');
    check('nobody adds an owner this way, not even the owner', ownerAddsOwner !== null,
      ownerAddsOwner ? '' : 'rpc succeeded');

    const { error: foreignOwner } = await add(other, hopeful, brunswick.id, 'staff');
    check('another organisation\'s owner cannot add people here', foreignOwner !== null,
      foreignOwner ? '' : 'rpc succeeded');

    const { data: unitedStaff } = await admin.from('memberships').select('user_id')
      .eq('org_id', united.id).eq('role', 'staff').limit(1).single();
    const { error: poached } = await add(owner, unitedStaff!.user_id, brunswick.id, 'staff');
    check('a login from another organisation cannot be pulled in', poached !== null, poached ? '' : 'rpc succeeded');

    const { error: ownerAddsManager } = await add(owner, hopeful, coburg.id, 'manager');
    check('the owner can add a manager at any of their sites', ownerAddsManager === null,
      ownerAddsManager?.message ?? '');

    const membershipOf = async (userId: string, orgId = metro.id) =>
      (await admin.from('memberships').select('id').eq('user_id', userId).eq('org_id', orgId).limit(1).single()).data!.id;
    const remove = (db: Db, membershipId: string) => db.rpc('remove_site_member', { p_membership_id: membershipId });

    const { data: ownerRow } = await admin.from('memberships').select('id').eq('org_id', metro.id).eq('role', 'owner').limit(1).single();
    const { error: removesOwner } = await remove(manager, ownerRow!.id);
    check('a manager cannot remove the owner', removesOwner !== null, removesOwner ? '' : 'rpc succeeded');

    const { error: removesManager } = await remove(manager, await membershipOf(hopeful));
    check('nor another manager', removesManager !== null, removesManager ? '' : 'rpc succeeded');

    const { error: removesSelf } = await remove(manager, await membershipOf(managerUser!.id));
    check('nor themselves', removesSelf !== null, removesSelf ? '' : 'rpc succeeded');

    const { error: staffRemoves } = await remove(staff, await membershipOf(newStaff));
    check('staff cannot remove anyone', staffRemoves !== null, staffRemoves ? '' : 'rpc succeeded');

    const { error: foreignRemove } = await remove(other, await membershipOf(newStaff));
    check('another organisation cannot remove people here', foreignRemove !== null, foreignRemove ? '' : 'rpc succeeded');

    const { error: managerRemoves } = await remove(manager, await membershipOf(newStaff));
    const { count: stillThere } = await admin.from('memberships').select('*', { count: 'exact', head: true }).eq('user_id', newStaff);
    const { data: login } = await admin.auth.admin.getUserById(newStaff);
    check('a manager can remove staff; the login stays, the access goes',
      managerRemoves === null && stillThere === 0 && !!login.user,
      managerRemoves?.message ?? `${stillThere} memberships left`);

    const { error: ownerRemoves } = await remove(owner, await membershipOf(hopeful));
    check('the owner can remove a manager', ownerRemoves === null, ownerRemoves?.message ?? '');

    const { error: readded } = await add(manager, newStaff, brunswick.id, 'staff');
    check('someone removed can be added back', readded === null, readded?.message ?? '');

    const archived = await signIn('owner@liberty-oil.test');
    const { data: libertySite } = await admin.from('sites').select('id')
      .eq('org_id', orgs!.find((o) => o.slug === 'liberty-oil')!.id).limit(1).single();
    const { error: archivedAdd } = await add(archived, hopeful, libertySite!.id, 'staff');
    check('an archived organisation cannot add people', archivedAdd !== null, archivedAdd ? '' : 'rpc succeeded');

    const anon = createClient<Database>(URL, ANON);
    const { error: anonAdd } = await add(anon, hopeful, brunswick.id, 'staff');
    check('anonymous callers cannot add people', anonAdd !== null, anonAdd ? '' : 'rpc succeeded');

    for (const id of made) await admin.auth.admin.deleteUser(id);
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

  console.log('\nnightly expiry-engine schedule (03:00 Melbourne):');
  {
    // The cron fires at 16:00 and 17:00 UTC; exactly one must be 03:00 in Melbourne,
    // including the nights the clocks change.
    const pairs: [string, string, string][] = [
      ['winter (AEST)', '2026-07-15T16:00:05Z', '2026-07-15T17:00:05Z'],
      ['summer (AEDT)', '2026-01-15T17:00:05Z', '2026-01-15T16:00:05Z'],
      ['clocks go back', '2026-04-04T16:00:05Z', '2026-04-04T17:00:05Z'],
      ['clocks go forward', '2026-10-03T17:00:05Z', '2026-10-03T16:00:05Z'],
    ];
    for (const [name, notDue, due] of pairs) {
      const { data: a } = await admin.rpc('expiry_engine_due', { p_at: notDue });
      const { data: b } = await admin.rpc('expiry_engine_due', { p_at: due });
      check(`runs exactly once a night: ${name}`, a === false && b === true, `got ${a} / ${b}`);
    }

    const anon = createClient<Database>(URL, ANON);
    const { error } = await anon.rpc('expiry_engine_due', {});
    check('anon cannot call the schedule helper', error !== null, error ? '' : 'call unexpectedly succeeded');
  }

  console.log('\nanonymous (no session):');
  {
    const anon = createClient<Database>(URL, ANON);
    for (const table of ['orgs', 'sites', 'suppliers', 'memberships', 'products', 'site_messages', 'site_message_reads'] as const) {
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

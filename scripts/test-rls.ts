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

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
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
  const admin = createClient<Database>(URL, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
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

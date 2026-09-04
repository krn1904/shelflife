/**
 * Seeds two independent orgs. Two, not one, because tenant isolation is the
 * security claim this system rests on and it cannot be tested with a single tenant.
 *
 * Run: npm run seed
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';

config({ path: '.env.local' });

const SEED_PASSWORD = 'shelflife-dev-password';

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type SeedUser = { email: string; fullName: string; role: Database['public']['Enums']['app_role'] };

async function upsertUser(u: SeedUser) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: SEED_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.fullName },
  });

  if (!error) return created.user.id;

  // Re-running the seed must be safe, so an existing user is looked up, not fatal.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((x) => x.email === u.email);
  if (!existing) throw new Error(`could not create or find ${u.email}: ${error.message}`);
  return existing.id;
}

async function seedOrg(opts: {
  name: string;
  slug: string;
  siteNames: string[];
  users: SeedUser[];
  suppliers: string[];
}) {
  const { data: org, error: orgError } = await admin
    .from('orgs')
    .upsert({ name: opts.name, slug: opts.slug }, { onConflict: 'slug' })
    .select()
    .single();
  if (orgError) throw orgError;

  const sites = [];
  for (const name of opts.siteNames) {
    const { data: existing } = await admin
      .from('sites').select().eq('org_id', org.id).eq('name', name).maybeSingle();
    if (existing) { sites.push(existing); continue; }
    const { data, error } = await admin
      .from('sites').insert({ org_id: org.id, name }).select().single();
    if (error) throw error;
    sites.push(data);
  }

  for (const u of opts.users) {
    const userId = await upsertUser(u);
    // Staff and managers are pinned to the first site; owners get a null
    // site_id, which auth_site_ids() expands to every site in the org.
    const siteId = u.role === 'owner' || u.role === 'platform_admin' ? null : sites[0].id;
    const { error } = await admin
      .from('memberships')
      .upsert({ user_id: userId, org_id: org.id, site_id: siteId, role: u.role },
              { onConflict: 'user_id,org_id,site_id' });
    if (error) throw error;
  }

  for (const name of opts.suppliers) {
    const { error } = await admin
      .from('suppliers').upsert({ org_id: org.id, name }, { onConflict: 'org_id,name' });
    if (error) throw error;
  }

  return { org, sites };
}

async function main() {
  const a = await seedOrg({
    name: 'Northside Fuel Co',
    slug: 'northside',
    siteNames: ['Brunswick', 'Coburg', 'Preston'],
    suppliers: ['Metcash', 'Coca-Cola Europacific', 'Lion Dairy', 'PFD Food Services'],
    users: [
      { email: 'owner@northside.test', fullName: 'Dana Owner', role: 'owner' },
      { email: 'manager@northside.test', fullName: 'Sam Manager', role: 'manager' },
      { email: 'staff@northside.test', fullName: 'Riley Staff', role: 'staff' },
      // A platform admin still needs an org row (org_id is NOT NULL); is_platform_admin()
      // then widens every policy regardless of which org that row points at.
      { email: 'admin@shelflife.test', fullName: 'Platform Admin', role: 'platform_admin' },
    ],
  });

  const b = await seedOrg({
    name: 'Bayside Servos',
    slug: 'bayside',
    siteNames: ['St Kilda'],
    suppliers: ['Metcash', 'Bakers Delight DSD'],
    users: [{ email: 'owner@bayside.test', fullName: 'Jo Bayside', role: 'owner' }],
  });

  // Global catalogue: shared across tenants by design.
  const products = [
    { barcode: '9300675024235', name: 'Coke Zero Sugar 1.25L', brand: 'Coca-Cola', size: '1.25L',
      category: 'Soft drinks', default_shelf_life_days: 270, tracking_mode: 'batch' as const },
    { barcode: '9300675024242', name: 'Coke Zero Sugar 2L', brand: 'Coca-Cola', size: '2L',
      category: 'Soft drinks', default_shelf_life_days: 240, tracking_mode: 'batch' as const },
    { barcode: '9300601001019', name: 'Full Cream Milk 2L', brand: 'Pura', size: '2L',
      category: 'Dairy', default_shelf_life_days: 12, tracking_mode: 'rotation' as const },
    { barcode: '9310072020105', name: 'Tip Top White Sandwich', brand: 'Tip Top', size: '700g',
      category: 'Bakery', default_shelf_life_days: 5, tracking_mode: 'rotation' as const },
    { barcode: '9300682001007', name: 'Mars Bar 53g', brand: 'Mars', size: '53g',
      category: 'Confectionery', default_shelf_life_days: 300, tracking_mode: 'batch' as const },
    { barcode: '9310155000017', name: 'Winfield Blue 25s', brand: 'Winfield', size: '25s',
      category: 'Tobacco', default_shelf_life_days: null, tracking_mode: 'none' as const },
  ];
  const { error: productError } = await admin
    .from('products').upsert(products, { onConflict: 'barcode' });
  if (productError) throw productError;

  const { data: catalogue } = await admin.from('products').select('id, barcode');

  // Range the whole catalogue at every site so each portal has real numbers to show.
  for (const { org, sites } of [a, b]) {
    for (const site of sites) {
      const rows = (catalogue ?? []).map((prod) => ({
        org_id: org.id,
        site_id: site.id,
        product_id: prod.id,
        retail_price: null,
        unit_cost: null,
        par_level: 12,
        fixture: null,
        active: true,
      }));
      const { error } = await admin
        .from('site_products').upsert(rows, { onConflict: 'site_id,product_id' });
      if (error) throw error;
    }
  }

  console.log(`seeded ${a.org.name} (${a.sites.length} sites), ${b.org.name} (${b.sites.length} site)`);
  console.log(`seeded ${products.length} catalogue products`);
  console.log(`all seed users share the password: ${SEED_PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

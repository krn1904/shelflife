/**
 * Seeds the demo tenant: three Melbourne sites, a few hundred products, and eight months
 * of delivery and waste history so every chart has a real shape rather than two points.
 *
 * Deterministic on purpose — a seeded PRNG, not Math.random — so the demo looks the same
 * every time it is rebuilt and a screenshot in the case study keeps matching the site.
 *
 * Run: npm run seed:demo
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { addDays, format, subDays } from 'date-fns';
import type { Database } from '../src/lib/supabase/database.types';
import { DEMO_LOGINS, DEMO_ORG_SLUG, DEMO_PASSWORD } from '../src/lib/demo/config';

config({ path: '.env.local' });

// Credentials, under either of the two names Supabase has used for them. The scripts
// read .env.local directly rather than going through src/lib/supabase/env.ts, because
// that module is compiled for the app and pulls in Next's build-time inlining.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!URL_) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in .env.local');
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local');

const HISTORY_DAYS = 240; // ~8 months
const SITE_NAMES = ['Brunswick', 'Coburg', 'Preston'];

const admin = createClient<Database>(
  URL_,
  SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** mulberry32 — small, fast, and identical across runs, which is the whole point. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(20260904);
const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

/** GTIN-13 check digit, so every generated barcode is one the app will actually accept. */
function withCheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return body12 + String((10 - (sum % 10)) % 10);
}

type Category = {
  name: string;
  tracking: Database['public']['Enums']['tracking_mode'];
  shelfLife: [number, number] | null;
  fixture: string;
  brands: string[];
  items: string[];
  sizes: string[];
  price: [number, number];
};

// Weighted so the catalogue looks like a servo's: mostly batch-tracked drinks and snacks,
// a thin band of rotation stock, and a handful of things nobody tracks at all.
const CATEGORIES: Category[] = [
  { name: 'Soft drinks', tracking: 'batch', shelfLife: [180, 300], fixture: 'Drinks fridge',
    brands: ['Coca-Cola', 'Pepsi', 'Schweppes', 'Solo', 'Kirks'],
    items: ['Cola', 'Zero Sugar', 'Lemonade', 'Creaming Soda', 'Dry Ginger', 'Lemon Squash'],
    sizes: ['375ml', '600ml', '1.25L', '2L'], price: [3, 6] },
  { name: 'Energy drinks', tracking: 'batch', shelfLife: [200, 360], fixture: 'Drinks fridge',
    brands: ['Red Bull', 'Monster', 'V', 'Mother'],
    items: ['Original', 'Sugar Free', 'Ultra', 'Mango', 'Watermelon'],
    sizes: ['250ml', '350ml', '500ml'], price: [4, 8] },
  { name: 'Confectionery', tracking: 'batch', shelfLife: [150, 330], fixture: 'Counter stand',
    brands: ['Cadbury', 'Mars', 'Nestlé', 'Allen’s', 'Darrell Lea'],
    items: ['Milk Chocolate', 'Caramel', 'Snack', 'Party Mix', 'Fruit Chews'],
    sizes: ['35g', '50g', '180g', '220g'], price: [2, 7] },
  { name: 'Chips & snacks', tracking: 'batch', shelfLife: [90, 210], fixture: 'Snack aisle',
    brands: ['Smith’s', 'Doritos', 'Red Rock Deli', 'Kettle', 'Twisties'],
    items: ['Original', 'Chicken', 'Salt & Vinegar', 'Sweet Chilli', 'Honey Soy'],
    sizes: ['45g', '90g', '170g'], price: [2, 6] },
  { name: 'Grocery', tracking: 'batch', shelfLife: [240, 540], fixture: 'Grocery shelf',
    brands: ['Heinz', 'SPC', 'Uncle Tobys', 'Kellogg’s', 'Vegemite'],
    items: ['Baked Beans', 'Spaghetti', 'Muesli Bars', 'Corn Flakes', 'Spread'],
    sizes: ['220g', '300g', '420g', '500g'], price: [3, 9] },
  { name: 'Chilled', tracking: 'batch', shelfLife: [21, 60], fixture: 'Chilled case',
    brands: ['Chobani', 'Yoplait', 'Bega', 'Primo'],
    items: ['Yoghurt', 'Cheese Slices', 'Ham', 'Salami Sticks'],
    sizes: ['100g', '150g', '170g', '250g'], price: [3, 8] },
  { name: 'Dairy', tracking: 'rotation', shelfLife: [8, 16], fixture: 'Dairy fridge',
    brands: ['Pura', 'Dairy Farmers', 'A2', 'Devondale'],
    items: ['Full Cream Milk', 'Light Milk', 'Skim Milk', 'Iced Coffee'],
    sizes: ['300ml', '600ml', '1L', '2L'], price: [3, 7] },
  { name: 'Bakery', tracking: 'rotation', shelfLife: [3, 7], fixture: 'Bread stand',
    brands: ['Tip Top', 'Wonder White', 'Helga’s', 'Bakers Delight'],
    items: ['White Sandwich', 'Wholemeal', 'Multigrain', 'Wraps', 'Rolls'],
    sizes: ['600g', '700g', '850g'], price: [4, 8] },
  { name: 'Food to go', tracking: 'rotation', shelfLife: [2, 4], fixture: 'Sandwich fridge',
    brands: ['Deli Fresh', 'On The Go'],
    items: ['Chicken Sandwich', 'Ham & Cheese', 'Egg & Lettuce', 'Caesar Wrap', 'Sushi Pack'],
    sizes: ['single'], price: [6, 12] },
  { name: 'Tobacco', tracking: 'none', shelfLife: null, fixture: 'Gantry',
    brands: ['Winfield', 'Longbeach', 'JPS', 'Horizon'],
    items: ['Blue', 'Gold', 'Red', 'Menthol'], sizes: ['20s', '25s', '30s', '40s'], price: [35, 70] },
  { name: 'Accessories', tracking: 'none', shelfLife: null, fixture: 'Counter stand',
    brands: ['Auto Care', 'RoadSide', 'Halo'],
    items: ['Phone Cable', 'Air Freshener', 'Screen Wash', 'Fuses', 'Wiper Blade'],
    sizes: ['each'], price: [5, 30] },
];

const SUPPLIERS = [
  { name: 'Metcash', categories: ['Grocery', 'Chips & snacks', 'Confectionery'], everyDays: 7 },
  { name: 'Coca-Cola Europacific', categories: ['Soft drinks', 'Energy drinks'], everyDays: 7 },
  { name: 'Lion Dairy & Drinks', categories: ['Dairy', 'Chilled'], everyDays: 3 },
  { name: 'Bakers Delight DSD', categories: ['Bakery', 'Food to go'], everyDays: 2 },
  { name: 'PFD Food Services', categories: ['Chilled', 'Grocery'], everyDays: 14 },
  { name: 'Tobacco Wholesale AU', categories: ['Tobacco', 'Accessories'], everyDays: 14 },
];

type BuiltProduct = {
  barcode: string;
  name: string;
  brand: string;
  size: string;
  category: string;
  default_shelf_life_days: number | null;
  tracking_mode: Database['public']['Enums']['tracking_mode'];
  fixture: string;
  price: number;
};

function buildCatalogue(target: number): BuiltProduct[] {
  const seen = new Set<string>();
  const products: BuiltProduct[] = [];
  let serial = 1;

  while (products.length < target) {
    const category = pick(CATEGORIES);
    const brand = pick(category.brands);
    const item = pick(category.items);
    const size = pick(category.sizes);
    const name = `${brand} ${item} ${size}`.replace(' single', '').replace(' each', '');
    if (seen.has(name)) continue;
    seen.add(name);

    products.push({
      barcode: withCheckDigit(String(93_00000_00000 + serial++).padStart(12, '0')),
      name,
      brand,
      size,
      category: category.name,
      default_shelf_life_days: category.shelfLife
        ? between(category.shelfLife[0], category.shelfLife[1])
        : null,
      tracking_mode: category.tracking,
      fixture: category.fixture,
      price: Number((category.price[0] + random() * (category.price[1] - category.price[0])).toFixed(2)),
    });
  }

  return products;
}

async function upsertUser(email: string, fullName: string) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (!error) return created.user.id;

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);
  if (!existing) throw new Error(`could not create or find ${email}: ${error.message}`);
  return existing.id;
}

async function main() {
  const today = new Date();

  const { data: org, error: orgError } = await admin
    .from('orgs')
    .upsert({ name: 'Demo Servo Group', slug: DEMO_ORG_SLUG, is_demo: true }, { onConflict: 'slug' })
    .select()
    .single();
  if (orgError) throw orgError;

  // Rebuild from scratch so re-running does not stack eight more months onto the last run.
  await admin.from('waste_events').delete().eq('org_id', org.id);
  await admin.from('expiry_actions').delete().eq('org_id', org.id);
  await admin.from('rotation_checks').delete().eq('org_id', org.id);
  await admin.from('stock_batches').delete().eq('org_id', org.id);
  await admin.from('deliveries').delete().eq('org_id', org.id);

  const sites = [];
  for (const name of SITE_NAMES) {
    const { data: existing } = await admin
      .from('sites').select().eq('org_id', org.id).eq('name', name).maybeSingle();
    if (existing) { sites.push(existing); continue; }
    const { data, error } = await admin
      .from('sites').insert({ org_id: org.id, name }).select().single();
    if (error) throw error;
    sites.push(data);
  }

  for (const login of DEMO_LOGINS) {
    const userId = await upsertUser(login.email, login.fullName);
    const siteId = login.role === 'owner' || login.role === 'platform_admin' ? null : sites[0].id;
    const { error } = await admin.from('memberships').upsert(
      { user_id: userId, org_id: org.id, site_id: siteId, role: login.role },
      { onConflict: 'user_id,org_id,site_id' },
    );
    if (error) throw error;
  }

  const suppliers = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const { data, error } = await admin
      .from('suppliers').upsert({ org_id: org.id, name: s.name }, { onConflict: 'org_id,name' })
      .select().single();
    if (error) throw error;
    suppliers.set(s.name, data.id);
  }

  const catalogue = buildCatalogue(400);
  // fixture and price are site-level facts, so they go to site_products, not the shared
  // catalogue — the insert is built explicitly rather than by stripping them off.
  const { error: productError } = await admin.from('products').upsert(
    catalogue.map((p) => ({
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      size: p.size,
      category: p.category,
      default_shelf_life_days: p.default_shelf_life_days,
      tracking_mode: p.tracking_mode,
    })),
    { onConflict: 'barcode' },
  );
  if (productError) throw productError;

  const { data: stored } = await admin
    .from('products').select('id, barcode, category, tracking_mode, default_shelf_life_days')
    .in('barcode', catalogue.map((p) => p.barcode));

  const byBarcode = new Map((stored ?? []).map((p) => [p.barcode!, p]));
  const meta = new Map(catalogue.map((p) => [byBarcode.get(p.barcode)!.id, p]));
  const productIds = [...meta.keys()];

  for (const site of sites) {
    const rows = productIds.map((id) => {
      const p = meta.get(id)!;
      return {
        org_id: org.id,
        site_id: site.id,
        product_id: id,
        retail_price: p.price,
        // Cost is what values the waste, so it has to be a plausible margin, not a guess.
        unit_cost: Number((p.price * 0.68).toFixed(2)),
        par_level: between(4, 24),
        fixture: p.fixture,
        active: true,
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin
        .from('site_products').upsert(rows.slice(i, i + 200), { onConflict: 'site_id,product_id' });
      if (error) throw error;
    }
  }

  let deliveryCount = 0;
  let batchCount = 0;
  let wasteCount = 0;

  for (const site of sites) {
    for (const supplier of SUPPLIERS) {
      const eligible = productIds.filter((id) => supplier.categories.includes(meta.get(id)!.category));
      if (eligible.length === 0) continue;

      for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo -= supplier.everyDays) {
        const receivedAt = subDays(today, daysAgo);
        const lineCount = between(4, 12);
        const chosen = new Set<string>();
        while (chosen.size < Math.min(lineCount, eligible.length)) chosen.add(pick(eligible));

        const { data: delivery, error: deliveryError } = await admin
          .from('deliveries')
          .insert({
            org_id: org.id,
            site_id: site.id,
            supplier_id: suppliers.get(supplier.name)!,
            docket_number: `${supplier.name.slice(0, 3).toUpperCase()}-${format(receivedAt, 'yyyyMMdd')}-${between(100, 999)}`,
            status: 'closed',
            received_at: receivedAt.toISOString(),
            closed_at: receivedAt.toISOString(),
          })
          .select('id')
          .single();
        if (deliveryError) throw deliveryError;
        deliveryCount++;

        const lines = [...chosen].map((productId) => ({
          org_id: org.id,
          delivery_id: delivery.id,
          product_id: productId,
          qty_docketed: between(2, 18),
          qty_received: 0,
        }));
        // A small share of lines arrive short — that gap is the signal v2 reconciliation reads.
        for (const line of lines) {
          line.qty_received = random() < 0.06
            ? Math.max(0, line.qty_docketed - between(1, 2))
            : line.qty_docketed;
        }

        const { data: savedLines, error: lineError } = await admin
          .from('delivery_lines').insert(lines).select('id, product_id, qty_received');
        if (lineError) throw lineError;

        const batches = (savedLines ?? [])
          .filter((l) => meta.get(l.product_id)!.tracking_mode === 'batch' && l.qty_received > 0)
          .map((l) => {
            const shelfLife = meta.get(l.product_id)!.default_shelf_life_days ?? 120;
            // Sold through as time passes, so old deliveries are not still full on the shelf.
            const soldFraction = Math.min(1, (HISTORY_DAYS - daysAgo) / HISTORY_DAYS + random() * 0.3);
            const remaining = Math.max(0, Math.round(l.qty_received * (1 - soldFraction)));
            return {
              org_id: org.id,
              site_id: site.id,
              product_id: l.product_id,
              delivery_line_id: l.id,
              expiry_date: format(addDays(receivedAt, shelfLife + between(-10, 10)), 'yyyy-MM-dd'),
              expiry_source: random() < 0.7 ? ('confirmed' as const) : ('predicted' as const),
              qty_received: l.qty_received,
              qty_remaining: remaining,
              status: remaining === 0 ? ('sold_through' as const) : ('active' as const),
            };
          });

        if (batches.length > 0) {
          const { error: batchError } = await admin.from('stock_batches').insert(batches);
          if (batchError) throw batchError;
          batchCount += batches.length;
        }
      }
    }
  }

  // Waste, weighted towards expiry — which is the whole point being demonstrated.
  const { data: allBatches } = await admin
    .from('stock_batches').select('id, product_id, site_id, expiry_date, qty_received')
    .eq('org_id', org.id);

  const wasteRows = [];
  for (const batch of allBatches ?? []) {
    if (random() > 0.09) continue;
    const p = meta.get(batch.product_id);
    if (!p) continue;
    const qty = between(1, Math.max(1, Math.floor(batch.qty_received * 0.4)));
    const daysAgo = between(0, HISTORY_DAYS);
    wasteRows.push({
      org_id: org.id,
      site_id: batch.site_id,
      product_id: batch.product_id,
      batch_id: batch.id,
      qty,
      reason: (random() < 0.62 ? 'expired' : pick(['damaged', 'spoiled', 'staff_error', 'other'])) as
        Database['public']['Enums']['waste_reason'],
      value_aud: Number((p.price * 0.68 * qty).toFixed(2)),
      wasted_at: subDays(today, daysAgo).toISOString(),
    });
  }

  for (let i = 0; i < wasteRows.length; i += 200) {
    const { error } = await admin.from('waste_events').insert(wasteRows.slice(i, i + 200));
    if (error) throw error;
    wasteCount += Math.min(200, wasteRows.length - i);
  }

  console.log(`demo org: ${org.name} (${sites.length} sites)`);
  console.log(`  ${catalogue.length} products, ${deliveryCount} deliveries, ${batchCount} batches, ${wasteCount} waste events`);
  console.log(`  logins: ${DEMO_LOGINS.map((l) => l.email).join(', ')}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log('\nRun the expiry engine to populate today\'s list.');
}

main().catch((e) => { console.error(e); process.exit(1); });

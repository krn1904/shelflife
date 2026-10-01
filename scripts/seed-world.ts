/**
 * The complete seed world: every organisation, person, product and event the reset
 * script writes, built as plain data with no database in sight.
 *
 * Everything is placed relative to "today" in Melbourne, so a fresh reset always shows
 * stock expiring today, this week and next month — not dates that went stale the week
 * after the seed was written. The PRNG is seeded, so the same day produces the same world.
 *
 * Rows that point at a person hold a user *key* (e.g. 'demo-staff') in their user column;
 * the reset script swaps keys for real auth ids once the accounts exist.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { TablesInsert } from '../src/lib/supabase/database.types';
import type { AppRole, TrackingMode, WasteReason } from '../src/lib/supabase/types';
import { DEMO_LOGINS, DEMO_ORG_SLUG, DEMO_PASSWORD } from '../src/lib/demo/config';
import {
  DEFAULT_REMINDER_SETTINGS, HORIZON_DAYS, planExpiryActions, planRotationChecks, remindersFor, shelfLifeGroup,
  type ReminderSettings,
} from '../supabase/functions/_shared/engine';
import { effectiveTrackingMode } from '../supabase/functions/_shared/tracking';
import { SEED_CATALOGUE } from './seed-catalogue';

export const SEED_PASSWORD = 'shelflife-dev-password';
export const SITE_TIMEZONE = 'Australia/Melbourne';

// ---------------------------------------------------------------------------------------
// Randomness and time

/** mulberry32 — small, fast, and identical across runs, which is the whole point. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GTIN-13 check digit, so every generated barcode is one the app will actually accept. */
function withCheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return body12 + String((10 - (sum % 10)) % 10);
}

/** The store's calendar date — the same "today" the expiry engine uses. */
export function melbourneDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** Minutes Melbourne is ahead of UTC at a given instant (600 or 660). */
function melbourneOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SITE_TIMEZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((local - at.getTime()) / 60000);
}

const shiftDay = (day: string, days: number) => format(addDays(parseISO(day), days), 'yyyy-MM-dd');
const dayGap = (later: string, earlier: string) =>
  differenceInCalendarDays(parseISO(later), parseISO(earlier));

// ---------------------------------------------------------------------------------------
// Catalogue

type Category = {
  name: string;
  tracking: TrackingMode;
  shelfLife: [number, number] | null;
  fixture: string;
  /** Brand → the lines it actually makes, so a generated name is one a shop would stock. */
  lines: Record<string, string[]>;
  sizes: string[];
  price: [number, number];
};

// Weighted so the catalogue looks like a servo's: mostly batch-tracked drinks and snacks,
// a thin band of rotation stock, and a handful of things nobody tracks at all.
const CATEGORIES: Category[] = [
  { name: 'Soft drinks', tracking: 'batch', shelfLife: [180, 300], fixture: 'Drinks fridge',
    lines: { 'Coca-Cola': ['Classic', 'No Sugar', 'Vanilla'], Pepsi: ['Max No Sugar', 'Cola'],
      Schweppes: ['Lemonade', 'Dry Ginger Ale', 'Lemon Lime & Bitters'], Solo: ['Original Lemon', 'Zero Sugar'],
      Kirks: ['Creaming Soda', 'Pasito', 'Lemon Squash'] },
    sizes: ['375ml', '600ml', '1.25L', '2L'], price: [3, 6] },
  { name: 'Energy drinks', tracking: 'batch', shelfLife: [200, 360], fixture: 'Drinks fridge',
    lines: { 'Red Bull': ['Energy Drink', 'Sugarfree', 'Red Edition Watermelon'],
      Monster: ['Energy Green', 'Ultra White', 'Mango Loco'], V: ['Green', 'Sugarfree', 'Blue'],
      Mother: ['Original', 'Epic Swell'] },
    sizes: ['250ml', '355ml', '500ml'], price: [4, 8] },
  { name: 'Confectionery', tracking: 'batch', shelfLife: [150, 330], fixture: 'Counter stand',
    lines: { Cadbury: ['Dairy Milk', 'Caramello Koala', 'Crunchie', 'Freddo'],
      Mars: ['Mars Bar', 'Snickers', 'Maltesers', 'Twix'], Nestlé: ['KitKat', 'Milkybar', 'Aero'],
      'Allen’s': ['Snakes Alive', 'Party Mix', 'Red Frogs'], 'Darrell Lea': ['Soft Eating Liquorice', 'Rocklea Road'] },
    sizes: ['35g', '50g', '180g', '220g'], price: [2, 7] },
  { name: 'Chips & snacks', tracking: 'batch', shelfLife: [90, 210], fixture: 'Snack aisle',
    lines: { 'Smith’s': ['Crinkle Cut Original', 'Salt & Vinegar', 'Chicken'],
      Doritos: ['Cheese Supreme', 'Nacho Cheese'], 'Red Rock Deli': ['Sea Salt', 'Sweet Chilli & Sour Cream'],
      Kettle: ['Sea Salt', 'Honey Soy Chicken'], Twisties: ['Cheese', 'Chicken'] },
    sizes: ['45g', '90g', '170g'], price: [2, 6] },
  { name: 'Grocery', tracking: 'batch', shelfLife: [240, 540], fixture: 'Grocery shelf',
    lines: { Heinz: ['Baked Beans', 'Tomato Soup'], SPC: ['Spaghetti', 'Diced Peaches'],
      'Uncle Tobys': ['Muesli Bars', 'Quick Oats'], 'Kellogg’s': ['Corn Flakes', 'Nutri-Grain'],
      Vegemite: ['Spread'] },
    sizes: ['220g', '300g', '420g', '500g'], price: [3, 9] },
  { name: 'Chilled', tracking: 'batch', shelfLife: [21, 60], fixture: 'Chilled case',
    lines: { Chobani: ['Greek Yoghurt Vanilla', 'Greek Yoghurt Strawberry'], Yoplait: ['Forme Yoghurt'],
      Bega: ['Cheese Slices', 'Stringers'], Primo: ['Shaved Ham', 'Kabana Sticks'] },
    sizes: ['100g', '150g', '170g', '250g'], price: [3, 8] },
  { name: 'Dairy', tracking: 'rotation', shelfLife: [8, 16], fixture: 'Dairy fridge',
    lines: { Pura: ['Full Cream Milk', 'Light Milk'], 'Dairy Farmers': ['Full Cream Milk', 'Thick Shake Chocolate'],
      A2: ['Full Cream Milk'], Oak: ['Chocolate Milk', 'Iced Coffee'] },
    sizes: ['300ml', '600ml', '1L', '2L'], price: [3, 7] },
  { name: 'Bakery', tracking: 'rotation', shelfLife: [3, 7], fixture: 'Bread stand',
    lines: { 'Tip Top': ['The One White', 'Wholemeal'], 'Wonder': ['White Sandwich', 'Wholemeal + Fibre'],
      'Helga’s': ['Mixed Grain', 'Wholemeal Grain'], 'Bakers Delight': ['Hi-Fibre Lo-GI', 'Cheesymite Scroll'] },
    sizes: ['600g', '700g', '850g'], price: [4, 8] },
  { name: 'Food to go', tracking: 'rotation', shelfLife: [2, 4], fixture: 'Sandwich fridge',
    lines: { 'Deli Fresh': ['Chicken & Mayo Sandwich', 'Ham Cheese & Tomato Sandwich', 'Egg & Lettuce Sandwich'],
      'On The Go': ['Chicken Caesar Wrap', 'Salmon Sushi Pack'] },
    sizes: ['single'], price: [6, 12] },
  { name: 'Tobacco', tracking: 'none', shelfLife: null, fixture: 'Gantry',
    lines: { Winfield: ['Blue', 'Gold'], Longbeach: ['Original', 'Rich'], JPS: ['Red', 'Blue'], Horizon: ['Blue'] },
    sizes: ['20s', '25s', '30s', '40s'], price: [35, 70] },
  { name: 'Accessories', tracking: 'none', shelfLife: null, fixture: 'Counter stand',
    lines: { 'Auto Care': ['Screen Wash', 'Blade Fuse Kit'], RoadSide: ['USB-C Car Charger', 'Phone Cable'],
      Little: ['Trees Air Freshener'] },
    sizes: ['each'], price: [5, 30] },
];

const CATEGORY_BY_NAME = new Map(CATEGORIES.map((c) => [c.name, c]));

// Scanned in by staff at the shelf rather than seeded — they show the global catalogue
// growing, and carry created_by so catalogue moderation has something to look at.
const SCANNED_PRODUCTS = [
  { name: 'Mount Franklin Lightly Sparkling Lime 450ml', brand: 'Mount Franklin', size: '450ml',
    category: 'Soft drinks', shelf: 270, tracking: 'batch' as const, by: 'demo-staff', daysAgo: 12 },
  { name: 'Chupa Chups Mega Sour Belts 90g', brand: 'Chupa Chups', size: '90g',
    category: 'Confectionery', shelf: 240, tracking: 'batch' as const, by: 'demo-staff', daysAgo: 6 },
  { name: 'Ultra Tune Tyre Shine 500ml', brand: 'Ultra Tune', size: '500ml',
    category: 'Accessories', shelf: null, tracking: 'none' as const, by: 'demo-manager', daysAgo: 3 },
  { name: 'Farmers Union Iced Coffee 600ml', brand: 'Farmers Union', size: '600ml',
    category: 'Dairy', shelf: 14, tracking: 'rotation' as const, by: 'metro-staff', daysAgo: 1 },
];

export type CatalogueProduct = {
  id: string;
  barcode: string;
  name: string;
  brand: string;
  size: string;
  category: string;
  shelfLife: number | null;
  tracking: TrackingMode;
  fixture: string;
  price: number;
  /** Slow sellers are what reach their date with stock left — the product's whole point. */
  slow: boolean;
  createdBy: string | null;
  createdAt: string | null;
};

// ---------------------------------------------------------------------------------------
// People and organisations

export type SeedUser = { key: string; email: string; fullName: string; password: string };

type MemberConfig = { user: string; role: AppRole; site: string | null };
type SiteConfig = { key: string; name: string; address: string };
type SupplierConfig = {
  name: string;
  categories: string[];
  everyDays: number;
  contact: string | null;
  active?: boolean;
  /** Made up, but passing the ABN check, so a docket printing it is recognised. */
  abn?: string;
};

type OrgConfig = {
  key: string;
  name: string;
  slug: string;
  isDemo: boolean;
  createdDaysAgo: number;
  /** Days of delivery and waste history. Zero for a newly onboarded organisation. */
  historyDays: number;
  /** When the site started acting on ShelfLife's list — waste falls away after it. */
  adoptedDaysAgo: number;
  /** Share of the catalogue each site ranges. */
  rangeShare: number;
  archivedDaysAgo: number | null;
  admin: string;
  sites: SiteConfig[];
  /** A site whose manager changed the reminder settings; every other site keeps the defaults. */
  reminders?: { site: string; by: string; settings: Partial<ReminderSettings> };
  members: MemberConfig[];
  suppliers: SupplierConfig[];
};

const SUPPLIERS: SupplierConfig[] = [
  { name: 'Metcash', abn: '36000002481', categories: ['Grocery', 'Chips & snacks', 'Confectionery'], everyDays: 7,
    contact: 'Rep: Priya — orders close Tuesday 2pm' },
  { name: 'Coca-Cola Europacific', abn: '65118204993', categories: ['Soft drinks', 'Energy drinks'], everyDays: 7,
    contact: 'Account 40031822 · 13 26 53' },
  { name: 'Lion Dairy & Drinks', abn: '93004322181', categories: ['Dairy', 'Chilled'], everyDays: 3,
    contact: 'Driver arrives 6:30–7:00am' },
  { name: 'Bakers Delight DSD', abn: '89612330104', categories: ['Bakery', 'Food to go'], everyDays: 2,
    contact: null },
  { name: 'PFD Food Services', abn: '13610051902', categories: ['Chilled', 'Grocery'], everyDays: 14,
    contact: 'Fortnightly, Thursday' },
  { name: 'Tobacco Wholesale AU', abn: '28004104889', categories: ['Tobacco', 'Accessories'], everyDays: 14,
    contact: 'Signature required on delivery' },
  // Never delivered yet: its first docket shows the "no history, enter by hand" path.
  { name: 'Local Bakehouse', categories: ['Bakery'], everyDays: 0,
    contact: 'New supplier — first delivery pending' },
  // Kept for history, hidden from the supplier picker.
  { name: 'Northern Wholesale (closed)', categories: [], everyDays: 0,
    contact: 'Account closed', active: false },
];

const demoKey = (role: AppRole) => `demo-${role === 'platform_admin' ? 'admin' : role}`;

const ORGS: OrgConfig[] = [
  {
    key: 'demo', name: 'BP Melbourne North (Demo)', slug: DEMO_ORG_SLUG, isDemo: true,
    createdDaysAgo: 250, historyDays: 240, adoptedDaysAgo: 90, rangeShare: 1,
    archivedDaysAgo: null, admin: 'demo-admin',
    // Coburg treats up to 14 days as short-life and halves the price 3 days out.
    reminders: { site: 'coburg', by: 'demo-coburg-manager', settings: { shortMaxDays: 14, shortMarkdownDays: 3 } },
    sites: [
      { key: 'brunswick', name: 'Brunswick', address: '212 Sydney Rd, Brunswick VIC 3056' },
      { key: 'coburg', name: 'Coburg', address: '480 Bell St, Coburg VIC 3058' },
      { key: 'preston', name: 'Preston', address: '15 High St, Preston VIC 3072' },
    ],
    members: [
      ...DEMO_LOGINS.map((l) => ({
        user: demoKey(l.role),
        role: l.role,
        site: l.role === 'staff' || l.role === 'manager' ? 'brunswick' : null,
      })),
      { user: 'demo-coburg-manager', role: 'manager', site: 'coburg' },
      { user: 'demo-coburg-staff', role: 'staff', site: 'coburg' },
      { user: 'demo-preston-staff', role: 'staff', site: 'preston' },
    ],
    suppliers: SUPPLIERS,
  },
  {
    key: 'metro', name: 'Metro Petroleum', slug: 'metro-petroleum', isDemo: false,
    createdDaysAgo: 200, historyDays: 180, adoptedDaysAgo: 60, rangeShare: 0.85,
    archivedDaysAgo: null, admin: 'platform-admin',
    // test-rls expects exactly three sites here and staff pinned to the first.
    sites: [
      { key: 'brunswick', name: 'Brunswick', address: '401 Lygon St, Brunswick East VIC 3057' },
      { key: 'coburg', name: 'Coburg', address: '1 Sydney Rd, Coburg VIC 3058' },
      { key: 'preston', name: 'Preston', address: '600 Plenty Rd, Preston VIC 3072' },
    ],
    members: [
      { user: 'metro-owner', role: 'owner', site: null },
      { user: 'metro-manager', role: 'manager', site: 'brunswick' },
      { user: 'metro-staff', role: 'staff', site: 'brunswick' },
      { user: 'metro-coburg-manager', role: 'manager', site: 'coburg' },
      { user: 'metro-preston-staff', role: 'staff', site: 'preston' },
      // A platform admin still needs an org row (org_id is NOT NULL); is_platform_admin()
      // then widens every policy regardless of which org that row points at.
      { user: 'platform-admin', role: 'platform_admin', site: null },
    ],
    suppliers: SUPPLIERS.filter((s) => s.name !== 'PFD Food Services'),
  },
  {
    key: 'united', name: 'United Petroleum', slug: 'united-petroleum', isDemo: false,
    createdDaysAgo: 120, historyDays: 90, adoptedDaysAgo: 45, rangeShare: 0.6,
    archivedDaysAgo: null, admin: 'platform-admin',
    sites: [{ key: 'st-kilda', name: 'St Kilda', address: '88 Fitzroy St, St Kilda VIC 3182' }],
    members: [
      { user: 'united-owner', role: 'owner', site: null },
      { user: 'united-staff', role: 'staff', site: 'st-kilda' },
    ],
    suppliers: SUPPLIERS.filter((s) =>
      ['Metcash', 'Coca-Cola Europacific', 'Lion Dairy & Drinks', 'Bakers Delight DSD'].includes(s.name)),
  },
  {
    // Archived: the platform-admin portal's "Archived organisations" list and Restore.
    key: 'liberty', name: 'Liberty Oil', slug: 'liberty-oil', isDemo: false,
    createdDaysAgo: 170, historyDays: 150, adoptedDaysAgo: 90, rangeShare: 0.5,
    archivedDaysAgo: 18, admin: 'platform-admin',
    sites: [
      { key: 'footscray', name: 'Footscray', address: '120 Ballarat Rd, Footscray VIC 3011' },
      { key: 'sunshine', name: 'Sunshine', address: '300 Hampshire Rd, Sunshine VIC 3020' },
    ],
    members: [
      { user: 'liberty-owner', role: 'owner', site: null },
      { user: 'liberty-manager', role: 'manager', site: 'footscray' },
    ],
    suppliers: SUPPLIERS.filter((s) =>
      ['Metcash', 'Coca-Cola Europacific', 'Lion Dairy & Drinks'].includes(s.name)),
  },
  {
    // Just onboarded: every empty state, and a site the admin can still remove.
    key: 'ampol', name: 'Ampol Eastern', slug: 'ampol-eastern', isDemo: false,
    createdDaysAgo: 2, historyDays: 0, adoptedDaysAgo: 0, rangeShare: 0,
    archivedDaysAgo: null, admin: 'platform-admin',
    sites: [{ key: 'ringwood', name: 'Ringwood', address: '55 Maroondah Hwy, Ringwood VIC 3134' }],
    members: [{ user: 'ampol-owner', role: 'owner', site: null }],
    suppliers: [],
  },
];

const USERS: SeedUser[] = [
  ...DEMO_LOGINS.map((l) => ({
    key: demoKey(l.role), email: l.email, fullName: l.fullName, password: DEMO_PASSWORD,
  })),
  { key: 'demo-coburg-manager', email: 'coburg.manager@demo.shelflife.app', fullName: 'Alex (demo Coburg manager)', password: DEMO_PASSWORD },
  { key: 'demo-coburg-staff', email: 'coburg.staff@demo.shelflife.app', fullName: 'Casey (demo Coburg staff)', password: DEMO_PASSWORD },
  { key: 'demo-preston-staff', email: 'preston.staff@demo.shelflife.app', fullName: 'Jordan (demo Preston staff)', password: DEMO_PASSWORD },
  { key: 'platform-admin', email: 'admin@shelflife.test', fullName: 'Platform Admin', password: SEED_PASSWORD },
  { key: 'metro-owner', email: 'owner@metro-petroleum.test', fullName: 'Dana Owner', password: SEED_PASSWORD },
  { key: 'metro-manager', email: 'manager@metro-petroleum.test', fullName: 'Sam Manager', password: SEED_PASSWORD },
  { key: 'metro-staff', email: 'staff@metro-petroleum.test', fullName: 'Riley Staff', password: SEED_PASSWORD },
  { key: 'metro-coburg-manager', email: 'coburg.manager@metro-petroleum.test', fullName: 'Morgan Coburg', password: SEED_PASSWORD },
  { key: 'metro-preston-staff', email: 'preston.staff@metro-petroleum.test', fullName: 'Taylor Preston', password: SEED_PASSWORD },
  { key: 'united-owner', email: 'owner@united-petroleum.test', fullName: 'Jo Nguyen', password: SEED_PASSWORD },
  { key: 'united-staff', email: 'staff@united-petroleum.test', fullName: 'Kai Walker', password: SEED_PASSWORD },
  { key: 'liberty-owner', email: 'owner@liberty-oil.test', fullName: 'Pat O’Brien', password: SEED_PASSWORD },
  { key: 'liberty-manager', email: 'manager@liberty-oil.test', fullName: 'Robin Singh', password: SEED_PASSWORD },
  { key: 'ampol-owner', email: 'owner@ampol-eastern.test', fullName: 'Ash Taylor', password: SEED_PASSWORD },
];

// ---------------------------------------------------------------------------------------
// The plan the reset script writes

export type OrgPlan = {
  key: string;
  org: TablesInsert<'orgs'>;
  /** Applied after every child row exists: archived orgs refuse new children. */
  archive: { archived_at: string; archived_by: string } | null;
  sites: TablesInsert<'sites'>[];
  memberships: TablesInsert<'memberships'>[];
  suppliers: TablesInsert<'suppliers'>[];
  siteProducts: TablesInsert<'site_products'>[];
  deliveries: TablesInsert<'deliveries'>[];
  deliveryLines: TablesInsert<'delivery_lines'>[];
  batches: TablesInsert<'stock_batches'>[];
  expiryActions: TablesInsert<'expiry_actions'>[];
  rotationChecks: TablesInsert<'rotation_checks'>[];
  reminderSettings: TablesInsert<'reminder_settings'>[];
  waste: TablesInsert<'waste_events'>[];
  audit: TablesInsert<'audit_log'>[];
};

export type World = {
  asOf: string;
  users: SeedUser[];
  products: TablesInsert<'products'>[];
  orgs: OrgPlan[];
  jobRuns: TablesInsert<'job_runs'>[];
};

/** Columns that hold a user key until the reset script resolves it to an auth id. */
export const USER_COLUMNS = [
  'created_by', 'user_id', 'received_by', 'actioned_by', 'checked_by', 'wasted_by',
  'actor_id', 'archived_by', 'updated_by',
] as const;

const NON_EXPIRY_NOTES: Record<Exclude<WasteReason, 'expired' | 'recalled'>, string[]> = {
  damaged: ['Case dropped unloading the truck', 'Crushed at the bottom of the pallet', 'Leaking can'],
  spoiled: ['Fridge door left ajar overnight', 'Blown packaging', 'Cool room hit 9°C'],
  staff_error: ['Scanned the wrong line on receipt', 'Opened for a customer tasting'],
  other: ['Customer return — seal broken', 'Pest damage in store room'],
};

export function buildWorld(now: Date): World {
  const random = rng(20260904);
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const chance = (p: number) => random() < p;
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const money = (n: number) => Number(n.toFixed(2));
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const s = hex.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };

  const asOf = melbourneDate(now);
  const latest = now.getTime() - 60_000;
  /** A Melbourne wall-clock time on `day`, never later than a minute ago. */
  const at = (day: string, hour: number, minute = 0): string => {
    const naive = Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
    const instant = naive - melbourneOffsetMinutes(new Date(naive)) * 60_000;
    return new Date(Math.min(instant, latest)).toISOString();
  };
  const dayAgo = (n: number) => shiftDay(asOf, -n);

  // --- catalogue --------------------------------------------------------------------
  const products: CatalogueProduct[] = [];
  const seenNames = new Set<string>();
  for (const p of SEED_CATALOGUE) {
    const category = CATEGORY_BY_NAME.get(p.category ?? '')!;
    seenNames.add(p.name);
    products.push({
      id: uuid(), barcode: p.barcode, name: p.name, brand: p.brand, size: p.size,
      category: p.category, shelfLife: p.default_shelf_life_days, tracking: p.tracking_mode,
      fixture: category.fixture,
      price: money(category.price[0] + random() * (category.price[1] - category.price[0])),
      slow: false, createdBy: null, createdAt: null,
    });
  }
  // ~300 lines: close to every brand/line/size combination above, about the range a busy
  // servo carries. The attempt cap stops a smaller table from spinning forever.
  let serial = 1;
  for (let attempt = 0; products.length < 300 && attempt < 20_000; attempt++) {
    const category = pick(CATEGORIES);
    const brand = pick(Object.keys(category.lines));
    const size = pick(category.sizes);
    const name = `${brand} ${pick(category.lines[brand])} ${size}`.replace(' single', '').replace(' each', '');
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    products.push({
      id: uuid(),
      barcode: withCheckDigit(String(93_00000_00000 + serial++).padStart(12, '0')),
      name, brand, size, category: category.name,
      shelfLife: category.shelfLife ? between(category.shelfLife[0], category.shelfLife[1]) : null,
      tracking: category.tracking, fixture: category.fixture,
      price: money(category.price[0] + random() * (category.price[1] - category.price[0])),
      slow: category.tracking === 'batch' && chance(0.25),
      createdBy: null, createdAt: null,
    });
  }
  for (const s of SCANNED_PRODUCTS) {
    const category = CATEGORY_BY_NAME.get(s.category)!;
    products.push({
      id: uuid(), barcode: withCheckDigit(String(93_10000_00000 + serial++).padStart(12, '0')),
      name: s.name, brand: s.brand, size: s.size, category: s.category, shelfLife: s.shelf,
      tracking: s.tracking, fixture: category.fixture, price: 4.5, slow: false,
      createdBy: s.by, createdAt: at(dayAgo(s.daysAgo), 14, 20),
    });
  }
  const productById = new Map(products.map((p) => [p.id, p]));

  // --- organisations ----------------------------------------------------------------
  const orgs: OrgPlan[] = ORGS.map((config) => {
    const orgId = uuid();
    const endDay = dayAgo(config.archivedDaysAgo ?? 0); // the org's last day of operation
    const createdAt = at(dayAgo(config.createdDaysAgo), 10, 5);
    const plan: OrgPlan = {
      key: config.key,
      org: { id: orgId, name: config.name, slug: config.slug, is_demo: config.isDemo, created_at: createdAt },
      archive: config.archivedDaysAgo === null ? null : {
        archived_at: at(endDay, 16, 40), archived_by: config.admin,
      },
      sites: [], memberships: [], suppliers: [], siteProducts: [], deliveries: [],
      deliveryLines: [], batches: [], expiryActions: [], rotationChecks: [], reminderSettings: [], waste: [], audit: [],
    };

    const siteIds = new Map(config.sites.map((s) => [s.key, uuid()]));
    config.sites.forEach((s, i) => plan.sites.push({
      id: siteIds.get(s.key)!, org_id: orgId, name: s.name, address: s.address,
      timezone: SITE_TIMEZONE, created_at: at(dayAgo(config.createdDaysAgo - i * 3), 10, 5),
    }));

    // Reminder plans per site: the defaults, unless this org's config changed one site's.
    const reminderSettings = new Map<string, ReminderSettings>();
    if (config.reminders) {
      const settings = { ...DEFAULT_REMINDER_SETTINGS, ...config.reminders.settings };
      const siteId = siteIds.get(config.reminders.site)!;
      reminderSettings.set(siteId, settings);
      plan.reminderSettings.push({
        site_id: siteId, org_id: orgId, updated_by: config.reminders.by,
        short_max_days: settings.shortMaxDays, medium_max_days: settings.mediumMaxDays,
        short_markdown_days: settings.shortMarkdownDays, medium_markdown_days: settings.mediumMarkdownDays,
        long_check_days: settings.longCheckDays, long_markdown_days: settings.longMarkdownDays,
      });
    }

    const membershipIds = new Map<string, string>();
    for (const m of config.members) {
      const id = uuid();
      membershipIds.set(m.user, id);
      plan.memberships.push({
        id, user_id: m.user, org_id: orgId, role: m.role,
        site_id: m.site ? siteIds.get(m.site)! : null,
        created_at: createdAt,
      });
    }

    // Who does the work at a site: its own staff and managers, else the owner.
    const handsAt = (siteKey: string) => {
      const local = config.members.filter((m) => m.site === siteKey).map((m) => m.user);
      return local.length > 0 ? local : [config.members.find((m) => m.role === 'owner')!.user];
    };

    const supplierIds = new Map<string, string>();
    for (const s of config.suppliers) {
      const id = uuid();
      supplierIds.set(s.name, id);
      plan.suppliers.push({
        id, org_id: orgId, name: s.name, contact_note: s.contact, active: s.active ?? true, abn: s.abn ?? null,
        created_at: createdAt,
      });
    }

    audit(plan, config.admin, 'platform_admin.created_organisation', createdAt,
      { site_id: siteIds.get(config.sites[0].key)!, subject_type: 'org', subject_id: orgId,
        detail: { name: config.name, slug: config.slug, site_name: config.sites[0].name } });
    config.sites.slice(1).forEach((s, i) => audit(plan, config.admin, 'platform_admin.created_site',
      at(dayAgo(config.createdDaysAgo - (i + 1) * 3), 10, 5),
      { site_id: siteIds.get(s.key)!, subject_type: 'site', subject_id: siteIds.get(s.key)!, detail: { name: s.name } }));
    config.members.filter((m) => m.role !== 'owner' && m.role !== 'platform_admin').forEach((m, i) =>
      audit(plan, config.admin, 'platform_admin.added_member',
        at(dayAgo(Math.max(0, config.createdDaysAgo - 1 - i)), 11, 30),
        { site_id: m.site ? siteIds.get(m.site)! : null, subject_type: 'membership',
          subject_id: membershipIds.get(m.user)!,
          detail: { email: USERS.find((u) => u.key === m.user)!.email, role: m.role } }));

    if (config.historyDays > 0) {
      simulate(config, plan, orgId, siteIds, supplierIds, handsAt, endDay, reminderSettings);
    }

    return plan;
  });

  // The stories an operator would want to see in an audit trail.
  const metro = orgs.find((o) => o.key === 'metro')!;
  const metroStaff = metro.memberships.find((m) => m.user_id === 'metro-staff')!;
  const coburgManager = metro.memberships.find((m) => m.user_id === 'metro-coburg-manager')!;
  audit(metro, 'platform-admin', 'platform_admin.updated_role', at(dayAgo(40), 9, 12),
    { site_id: coburgManager.site_id, subject_type: 'membership', subject_id: coburgManager.id!,
      detail: { role: 'manager' } });
  audit(metro, 'platform-admin', 'platform_admin.password_reset_requested', at(dayAgo(12), 15, 2),
    { subject_type: 'membership', subject_id: metroStaff.id! });
  audit(metro, 'platform-admin', 'platform_admin.reset_password', at(dayAgo(12), 15, 2),
    { subject_type: 'membership', subject_id: metroStaff.id!, detail: { email: 'staff@metro-petroleum.test' } });
  audit(metro, 'platform-admin', 'platform_admin.viewed_organisation', at(dayAgo(1), 10, 45),
    { subject_type: 'org', subject_id: metro.org.id! });

  const united = orgs.find((o) => o.key === 'united')!;
  audit(united, 'platform-admin', 'platform_admin.archived_organisation', at(dayAgo(45), 17, 0),
    { subject_type: 'org', subject_id: united.org.id! });
  audit(united, 'platform-admin', 'platform_admin.restored_organisation', at(dayAgo(43), 9, 30),
    { subject_type: 'org', subject_id: united.org.id! });

  for (const plan of orgs.filter((o) => o.archive)) {
    audit(plan, plan.archive!.archived_by, 'platform_admin.archived_organisation', plan.archive!.archived_at,
      { subject_type: 'org', subject_id: plan.org.id! });
  }

  return {
    asOf,
    users: USERS,
    products: products.map((p) => ({
      id: p.id, barcode: p.barcode, name: p.name, brand: p.brand, size: p.size,
      category: p.category, default_shelf_life_days: p.shelfLife, tracking_mode: p.tracking,
      created_by: p.createdBy, ...(p.createdAt ? { created_at: p.createdAt } : {}),
    })),
    orgs,
    jobRuns: jobHistory(),
  };

  // -------------------------------------------------------------------------------------

  function audit(
    plan: OrgPlan, actor: string, action: string, createdAt: string,
    extra: Partial<TablesInsert<'audit_log'>>,
  ) {
    plan.audit.push({ actor_id: actor, action, org_id: plan.org.id!, created_at: createdAt, ...extra });
  }

  function simulate(
    config: OrgConfig,
    plan: OrgPlan,
    orgId: string,
    siteIds: Map<string, string>,
    supplierIds: Map<string, string>,
    handsAt: (siteKey: string) => string[],
    endDay: string,
    reminderSettings: Map<string, ReminderSettings>,
  ) {
    const adoptionDay = dayAgo(config.adoptedDaysAgo);
    const firstDay = dayAgo(config.historyDays);
    const historyLength = dayGap(endDay, firstDay);
    const batchesBySite: { batch: TablesInsert<'stock_batches'>; received: string; expiry: string }[][] = [];

    config.sites.forEach((site, siteIndex) => {
      const siteId = siteIds.get(site.key)!;
      const hands = handsAt(site.key);

      // Ranging: most of the catalogue, a few lines switched off, and the odd site that
      // tracks a product differently from the catalogue default.
      const ranged = new Map<string, { mode: TrackingMode; cost: number; active: boolean }>();
      for (const product of products) {
        if (product.createdBy) continue; // scanned in recently; not ranged anywhere yet
        if (!chance(config.rangeShare)) continue;
        let override: TrackingMode | null = null;
        if (siteIndex === 0 && product.category === 'Chilled' && chance(0.35)) override = 'rotation';
        if (siteIndex === 1 && product.category === 'Confectionery' && chance(0.12)) override = 'none';
        const price = money(product.price * (0.95 + random() * 0.1));
        const cost = money(price * (0.62 + random() * 0.1));
        const active = chance(0.96);
        ranged.set(product.id, { mode: effectiveTrackingMode(product.tracking, override), cost, active });
        plan.siteProducts.push({
          org_id: orgId, site_id: siteId, product_id: product.id, retail_price: price,
          unit_cost: cost, par_level: between(4, 24), fixture: product.fixture,
          tracking_mode_override: override, active,
        });
      }

      const batchesHere: { batch: TablesInsert<'stock_batches'>; received: string; expiry: string }[] = [];

      for (const supplier of config.suppliers) {
        if (supplier.everyDays === 0) continue;
        const eligible = [...ranged.entries()]
          .filter(([id, r]) => r.active && supplier.categories.includes(productById.get(id)!.category))
          .map(([id]) => id);
        if (eligible.length === 0) continue;

        // A supplier sends much the same lines each time — that regularity is what lets
        // the intake screen pre-fill the next docket from history.
        const regulars = [...eligible].sort(() => random() - 0.5).slice(0, between(8, 14));

        for (let day = shiftDay(firstDay, between(0, supplier.everyDays - 1)); dayGap(endDay, day) >= 1;
          day = shiftDay(day, supplier.everyDays + (chance(0.1) ? 1 : 0))) {
          const deliveryId = uuid();
          const receivedAt = at(day, between(6, 10), between(0, 59));
          const closedAt = new Date(Date.parse(receivedAt) + between(4, 25) * 60_000).toISOString();
          plan.deliveries.push({
            id: deliveryId, org_id: orgId, site_id: siteId, supplier_id: supplierIds.get(supplier.name)!,
            docket_number: `${supplier.name.slice(0, 3).toUpperCase()}-${day.replaceAll('-', '')}-${between(100, 999)}`,
            status: 'closed', received_by: pick(hands), received_at: receivedAt, closed_at: closedAt,
            created_at: receivedAt,
          });

          const lineProducts = new Set(regulars.filter(() => chance(0.8)));
          for (let extra = between(0, 2); extra > 0; extra--) lineProducts.add(pick(eligible));

          for (const productId of lineProducts) {
            const product = productById.get(productId)!;
            const site = ranged.get(productId)!;
            const qtyDocketed = between(2, 18);
            // A small share arrive short — that gap is the signal v2 reconciliation reads.
            const qtyReceived = chance(0.06) ? Math.max(1, qtyDocketed - between(1, 3)) : qtyDocketed;
            const lineId = uuid();
            plan.deliveryLines.push({
              id: lineId, org_id: orgId, delivery_id: deliveryId, product_id: productId,
              qty_docketed: qtyDocketed, qty_received: qtyReceived, unit_cost: site.cost,
              created_at: receivedAt,
            });

            if (site.mode !== 'batch' || !product.shelfLife) continue;

            // Short-dated stock happens; so does a generous date.
            const shelf = Math.max(3, Math.round(product.shelfLife * (0.88 + random() * 0.17)));
            const expiry = shiftDay(day, shelf);
            const postAdoption = dayGap(expiry, adoptionDay) > 0;
            // Days to sell the case. Slow sellers outlast their date; after adoption the
            // T-7 markdown clears a good share of what would otherwise have been binned.
            let sellDays = shelf * (product.slow ? 1.1 + random() * 1.4 : 0.25 + random() * 0.6);
            if (postAdoption && product.slow) sellDays *= 0.55;
            const left = (t: number) => (t >= sellDays ? 0 : Math.round(qtyReceived * (1 - t / sellDays)));

            const batch: TablesInsert<'stock_batches'> = {
              id: uuid(), org_id: orgId, site_id: siteId, product_id: productId,
              delivery_line_id: lineId, expiry_date: expiry,
              expiry_source: chance(0.7) ? 'confirmed' : chance(0.85) ? 'predicted' : 'manual',
              qty_received: qtyReceived, qty_remaining: 0, status: 'sold_through',
              created_at: closedAt,
            };

            const daysPast = dayGap(endDay, expiry);
            if (daysPast <= 0) {
              batch.qty_remaining = left(dayGap(endDay, day));
              batch.status = batch.qty_remaining > 0 ? 'active' : 'sold_through';
            } else {
              const leftover = left(shelf);
              if (leftover > 0 && daysPast <= 6 && chance(postAdoption ? 0.3 : 0.5)) {
                // Still on the shelf past its date: tomorrow's "pull" on the list.
                batch.qty_remaining = leftover;
                batch.status = 'active';
              } else if (leftover > 0) {
                // Before ShelfLife it was found weeks later; after, the pull fires on the day.
                const found = shiftDay(expiry, postAdoption ? between(0, 1) : between(7, 45));
                const wastedDay = dayGap(endDay, found) >= 0 ? found : endDay;
                batch.status = 'pulled';
                plan.waste.push({
                  org_id: orgId, site_id: siteId, product_id: productId, batch_id: batch.id,
                  qty: leftover, reason: 'expired', value_aud: money(site.cost * leftover),
                  wasted_by: pick(hands), wasted_at: at(wastedDay, between(7, 20), between(0, 59)),
                  note: postAdoption ? null : chance(0.3) ? 'Found at the back of the store room' : null,
                });
                if (postAdoption) {
                  plan.expiryActions.push({
                    org_id: orgId, site_id: siteId, batch_id: batch.id!, action: 'pull',
                    due_date: expiry, state: 'done', actioned_by: pick(hands),
                    actioned_at: at(wastedDay, between(7, 11), between(0, 59)),
                  });
                }
              }
              if (postAdoption && product.slow && batch.status === 'sold_through' && daysPast <= 60) {
                plan.expiryActions.push({
                  org_id: orgId, site_id: siteId, batch_id: batch.id!, action: 'markdown',
                  due_date: expiry, state: chance(0.9) ? 'done' : 'dismissed', actioned_by: pick(hands),
                  actioned_at: at(shiftDay(expiry, -between(3, 6)), between(7, 15), between(0, 59)),
                });
              }
            }
            plan.batches.push(batch);
            batchesHere.push({ batch, received: day, expiry });
          }
        }
      }

      batchesBySite.push(batchesHere);

      // Knocks, spills and mistakes: not what the product prevents, but part of the picture.
      for (let week = 0; week * 7 < historyLength; week++) {
        for (let n = between(0, 2); n > 0; n--) {
          const day = shiftDay(firstDay, week * 7 + between(0, 6));
          if (dayGap(endDay, day) < 0) continue;
          const candidates = batchesHere.filter((b) =>
            dayGap(day, b.received) >= 0 && dayGap(b.expiry, day) > 0);
          if (candidates.length === 0) continue;
          const { batch } = pick(candidates);
          const product = productById.get(batch.product_id)!;
          const reason: Exclude<WasteReason, 'expired' | 'recalled'> =
            product.category === 'Chilled' && chance(0.5) ? 'spoiled'
              : pick(['damaged', 'damaged', 'damaged', 'staff_error', 'other'] as const);
          const onShelf = batch.status === 'active' ? batch.qty_remaining : batch.qty_received;
          const qty = Math.min(between(1, 2), Math.max(1, onShelf));
          const wastedSoFar = plan.waste.reduce((n, w) => n + (w.batch_id === batch.id ? w.qty : 0), 0);
          if (wastedSoFar + qty > batch.qty_received) continue;
          if (batch.status === 'active') {
            if (batch.qty_remaining < qty) continue;
            batch.qty_remaining -= qty;
            if (batch.qty_remaining === 0) batch.status = 'pulled';
          }
          plan.waste.push({
            org_id: orgId, site_id: siteId, product_id: batch.product_id, batch_id: batch.id,
            qty, reason, value_aud: money(ranged.get(batch.product_id)!.cost * qty),
            note: chance(0.6) ? pick(NON_EXPIRY_NOTES[reason]) : null,
            wasted_by: pick(hands), wasted_at: at(day, between(8, 21), between(0, 59)),
          });
        }
      }

      // Rotation stock carries no batches, so its write-offs carry no batch either.
      const rotationProducts = [...ranged.entries()].filter(([, r]) => r.active && r.mode === 'rotation');
      // Kept small on purpose: rotation stock is rotated by eye and is not where money goes.
      for (let day = firstDay; dayGap(endDay, day) >= 0; day = shiftDay(day, between(2, 5))) {
        if (rotationProducts.length === 0) break;
        const [productId, site] = pick(rotationProducts);
        const qty = between(1, 2);
        plan.waste.push({
          org_id: orgId, site_id: siteId, product_id: productId, batch_id: null, qty,
          reason: chance(0.6) ? 'expired' : chance(0.75) ? 'spoiled' : 'damaged',
          value_aud: money(site.cost * qty), wasted_by: pick(hands),
          wasted_at: at(day, between(6, 22), between(0, 59)),
        });
      }

      // The daily fixture list for the last three weeks: mostly ticked, the odd miss.
      const fixtures = planRotationChecks(
        plan.siteProducts
          .filter((sp) => sp.site_id === siteId && sp.active && sp.fixture &&
            effectiveTrackingMode(productById.get(sp.product_id)!.tracking, sp.tracking_mode_override) === 'rotation')
          .map((sp) => ({ orgId, siteId, fixture: sp.fixture! })),
        endDay,
      );
      for (let back = 20; back >= 0; back--) {
        const day = shiftDay(endDay, -back);
        fixtures.forEach((f, i) => {
          const isToday = back === 0;
          const state = isToday ? (i === 0 ? 'done' : 'open')
            : chance(0.88) ? 'done' : chance(0.35) ? 'dismissed' : 'open';
          plan.rotationChecks.push({
            org_id: orgId, site_id: siteId, fixture: f.fixture, check_date: day, state,
            checked_by: state === 'open' ? null : pick(hands),
            checked_at: state === 'open' ? null : at(day, 7, between(0, 50)),
          });
        });
      }
    });

    // One recall — the reason code nobody wants to use. It withdraws every case of one
    // chilled line that was on the first site's shelf that day.
    const recallDay = shiftDay(endDay, -Math.min(40, Math.floor(historyLength / 2)));
    const alreadyWasted = new Set(plan.waste.map((w) => w.batch_id));
    const recallable = plan.batches.filter((b) =>
      b.site_id === siteIds.get(config.sites[0].key) &&
      productById.get(b.product_id)!.category === 'Chilled' && !alreadyWasted.has(b.id) &&
      melbourneDate(new Date(b.created_at!)) < recallDay && b.expiry_date! > recallDay);
    if (recallable.length > 0) {
      const recalled = pick(recallable).product_id;
      for (const batch of recallable.filter((b) => b.product_id === recalled)) {
        const qty = Math.max(1, Math.round(batch.qty_received * 0.5));
        batch.qty_remaining = 0;
        batch.status = 'pulled';
        const cost = plan.siteProducts.find((sp) => sp.site_id === batch.site_id && sp.product_id === recalled)!.unit_cost!;
        const siteKey = config.sites.find((s) => siteIds.get(s.key) === batch.site_id)!.key;
        plan.waste.push({
          org_id: orgId, site_id: batch.site_id, product_id: recalled, batch_id: batch.id, qty,
          reason: 'recalled', value_aud: money(cost * qty),
          note: 'Supplier recall notice RC-2026-117 — whole batch withdrawn',
          wasted_by: handsAt(siteKey)[0], wasted_at: at(recallDay, 9, 15),
        });
      }
    }

    // Last, so no write-off above can empty a column this fills.
    for (const batchesHere of batchesBySite) ensureBoardCoverage(batchesHere, endDay);

    // Answers staff already gave on earlier days: some stock is on half price (its last-day
    // card says since when), and some long-life checks are done. Only on days before today.
    for (const { batch, expiry } of batchesBySite.flat()) {
      if (batch.status !== 'active' || !batch.qty_remaining) continue;
      const settings = reminderSettings.get(batch.site_id) ?? DEFAULT_REMINDER_SETTINGS;
      const arrived = melbourneDate(new Date(batch.created_at!));
      const group = shelfLifeGroup(arrived, expiry, settings);
      const steps = remindersFor(group, settings);
      const markdownDay = shiftDay(expiry, -steps.find((r) => r.action === 'markdown')!.daysBefore);
      const checkStep = steps.find((r) => r.action === 'check');
      const siteKey = config.sites.find((x) => siteIds.get(x.key) === batch.site_id)!.key;
      const answered = (action: 'markdown' | 'check', day: string) => {
        const when = at(day, between(7, 11), between(0, 59));
        plan.expiryActions.push({
          org_id: orgId, site_id: batch.site_id, batch_id: batch.id!, action, due_date: expiry,
          state: 'done', actioned_by: pick(handsAt(siteKey)), actioned_at: when,
        });
        return when;
      };

      // Answered after it arrived and before today.
      if (dayGap(endDay, markdownDay) > 0 && dayGap(markdownDay, arrived) >= 0 && chance(0.6)) {
        batch.marked_down_at = answered('markdown', markdownDay);
      } else if (checkStep && dayGap(endDay, shiftDay(expiry, -checkStep.daysBefore)) > 0 && chance(0.4)) {
        batch.checked_at = answered('check', shiftDay(expiry, -checkStep.daysBefore));
      }
    }

    // What the engine would have put on today's list, via the engine's own rules.
    const open = planExpiryActions(
      plan.batches
        .filter((b) => b.status === 'active' && b.qty_remaining > 0)
        .map((b) => ({
          id: b.id!, orgId, siteId: b.site_id, expiryDate: b.expiry_date ?? null,
          arrivedOn: melbourneDate(new Date(b.created_at!)),
          checked: Boolean(b.checked_at), markedDown: Boolean(b.marked_down_at),
        })),
      endDay,
      reminderSettings,
    );
    for (const action of open) {
      plan.expiryActions.push({
        org_id: orgId, site_id: action.siteId, batch_id: action.batchId,
        action: action.action, due_date: action.dueDate, state: 'open',
        created_at: at(endDay, 2, 0),
      });
    }

    // Deliveries still being counted in: one per site, plus a first-ever docket from a
    // supplier with no history so the manual-entry path has something to show.
    if (config.archivedDaysAgo === null) {
      config.sites.forEach((site, i) => {
        const supplier = config.suppliers.find((s) => s.name === 'Lion Dairy & Drinks') ?? config.suppliers[0];
        const startedAt = new Date(now.getTime() - (35 + i * 20) * 60_000).toISOString();
        plan.deliveries.push({
          id: uuid(), org_id: orgId, site_id: siteIds.get(site.key)!,
          supplier_id: supplierIds.get(supplier.name)!, status: 'draft',
          received_by: handsAt(site.key)[0], received_at: startedAt, created_at: startedAt,
        });
      });
      if (supplierIds.has('Local Bakehouse')) {
        const startedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
        plan.deliveries.push({
          id: uuid(), org_id: orgId, site_id: siteIds.get(config.sites[0].key)!,
          supplier_id: supplierIds.get('Local Bakehouse')!, status: 'draft',
          received_by: handsAt(config.sites[0].key)[0], received_at: startedAt, created_at: startedAt,
        });
      }
    }
  }

  /**
   * Every column of the expiry board and every rung of the action ladder should have
   * something in it on the day of a reset. Where the simulation left a gap, a batch
   * that was delivered short-dated fills it — the ordinary way stock ends up there.
   */
  function ensureBoardCoverage(
    batches: { batch: TablesInsert<'stock_batches'>; received: string; expiry: string }[],
    endDay: string,
  ) {
    const targets = [-3, -1, 0, 1, 2, 3, 5, 6, 10, 13, 20, 27];
    const used = new Set<string>();
    for (const offset of targets) {
      const target = shiftDay(endDay, offset);
      if (batches.some((b) => b.batch.status === 'active' && b.batch.qty_remaining > 0 && b.expiry === target)) continue;
      const spares = batches.filter((b) =>
        b.batch.status === 'active' && b.batch.qty_remaining > 0 &&
        dayGap(b.expiry, endDay) > HORIZON_DAYS && dayGap(target, b.received) >= 7);
      const fresh = spares.filter((b) => !used.has(b.batch.product_id));
      if (spares.length === 0) continue;
      const spare = pick(fresh.length > 0 ? fresh : spares);
      used.add(spare.batch.product_id);
      spare.expiry = target;
      spare.batch.expiry_date = target;
      spare.batch.expiry_source = offset < 0 ? 'predicted' : 'confirmed';
    }
  }

  function jobHistory(): TablesInsert<'job_runs'>[] {
    const runs: TablesInsert<'job_runs'>[] = [];
    const openNow = orgs.filter((o) => !o.archive)
      .reduce((n, o) => n + o.expiryActions.filter((a) => a.state === 'open').length, 0);
    const checksNow = orgs.filter((o) => !o.archive)
      .reduce((n, o) => n + o.rotationChecks.filter((c) => c.check_date === asOf).length, 0);
    for (let back = 20; back >= 0; back--) {
      const day = dayAgo(back);
      const engineAt = at(day, 2, 0);
      if (Date.parse(engineAt) >= latest && back === 0) continue;
      const failed = back === 9;
      const processed = failed ? 0 : Math.max(0, openNow + between(-25, 25));
      runs.push({
        job: 'expiry-engine', ran_at: engineAt, ok: !failed, processed,
        skipped: failed ? 0 : between(2500, 3200), duration_ms: failed ? 30_000 : between(800, 2400),
        reason: failed
          ? 'canceling statement due to statement timeout'
          : `${processed} actions, ${checksNow} rotation checks, horizon ${HORIZON_DAYS}d`,
      });
      const digestAt = at(day, 6, 0);
      if (back === 0 && Date.parse(digestAt) >= latest) continue;
      const pushes = failed ? 0 : between(3, 9);
      runs.push({
        job: 'daily-digest', ran_at: digestAt, ok: true, processed: pushes, skipped: between(0, 2),
        duration_ms: between(300, 1500), reason: `${pushes} pushes sent, 0 skipped`,
      });
    }
    return runs;
  }
}

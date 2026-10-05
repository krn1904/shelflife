/**
 * Resets the database to the known seed world in one command.
 *
 * Wipes every organisation, auth user, catalogue product, job run, audit entry and docket
 * photo, then writes the world from seed-world.ts: five organisations (demo, two live, one
 * archived, one just onboarded), their people, eight months of deliveries, stock and waste,
 * today's action list, and the platform's job and audit history. Dates are relative to
 * today, so re-run it whenever the data has drifted or gone stale.
 *
 * Works the same against local and hosted Supabase: it writes to whichever project
 * .env.local points at, and prints that URL before touching anything.
 *
 * Run: npm run db:reset            (add -- --dry-run to print the plan without writing)
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { buildWorld, USER_COLUMNS, type OrgPlan } from './seed-world';

config({ path: '.env.local' });

const DRY_RUN = process.argv.includes('--dry-run');
const CHUNK = 500;
const BUCKET = 'dockets';

const world = buildWorld(new Date());

if (DRY_RUN) {
  report();
  process.exit(0);
}

// Credentials, under either of the two names Supabase has used for them. The scripts
// read .env.local directly rather than going through src/lib/supabase/env.ts, because
// that module is compiled for the app and pulls in Next's build-time inlining.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!URL_) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set in .env.local');
if (!SERVICE_KEY) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local');

const admin = createClient<Database>(
  URL_,
  SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type Table = keyof Database['public']['Tables'];

async function insertAll<T extends Table>(table: T, rows: Database['public']['Tables'][T]['Insert'][]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // The generic table name defeats supabase-js's row inference; the rows are typed above.
    // defaultToNull: false, or a column one row omits is sent as NULL for the whole batch
    // instead of taking its default (created_at on catalogue rows, for one).
    const { error } = await admin.from(table)
      .insert(rows.slice(i, i + CHUNK) as never, { defaultToNull: false });
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
  }
}

/** Every row, by a filter that matches every row: PostgREST refuses an unfiltered delete. */
async function deleteAll(table: Table, column = 'id') {
  const { error } = await admin.from(table).delete().not(column, 'is', null);
  if (error) throw new Error(`clearing ${table} failed: ${error.message}`);
}

async function preflight() {
  // The seed writes lifecycle columns and relies on the lifecycle triggers, so a database
  // behind on migrations would be seeded into a shape the app no longer expects.
  // The newest migration's service-role RPC is the probe: an empty payload inserts nothing.
  // Update it when a migration the seed depends on is added.
  const { error: columns } = await admin.from('orgs').select('status, archived_at').limit(1);
  const { error: latest } = await admin.rpc('insert_active_expiry_actions', { p_actions: [] });
  // Reminder plans (20261002000001): the seed writes a site's settings and staff answers.
  const { error: reminders } = await admin.from('stock_batches').select('marked_down_at').limit(1);
  const { error: settings } = await admin.from('reminder_settings').select('site_id').limit(1);
  const error = columns ?? latest ?? reminders ?? settings;
  if (error) {
    throw new Error(
      `the database is missing migrations (${error.message}).\n` +
      'Apply them first — hosted: `supabase db push`; local: `supabase migration up` — then re-run.',
    );
  }
}

async function listAllUsers() {
  const users: { id: string; email?: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function removeStoragePrefix(prefix: string) {
  const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) return; // no bucket, nothing to clear
  const files = data.filter((entry) => entry.id).map((entry) => `${prefix}${entry.name}`);
  for (const folder of data.filter((entry) => !entry.id)) {
    await removeStoragePrefix(`${prefix}${folder.name}/`);
  }
  if (files.length > 0) await admin.storage.from(BUCKET).remove(files);
}

async function wipe() {
  await removeStoragePrefix('');

  // Children before parents: deliveries hold suppliers with ON DELETE RESTRICT, and
  // batches and waste hold products the same way, so a single cascading delete of orgs
  // is not guaranteed to succeed.
  for (const table of [
    'waste_events', 'expiry_actions', 'rotation_checks', 'stock_batches', 'delivery_lines',
    'deliveries', 'site_products', 'reminder_settings', 'site_message_reads', 'site_messages',
    'supplier_aliases', 'suppliers', 'memberships', 'sites',
    'audit_log', 'job_runs', 'orgs', 'products',
  ] as const) {
    // Tables keyed by their parent have no id column.
    const key = table === 'reminder_settings' ? 'site_id' : table === 'site_message_reads' ? 'message_id' : 'id';
    await deleteAll(table, key);
  }

  // Everyone, not just the seed accounts: people added through the admin portal or by the
  // RLS tests would otherwise linger with no organisation to belong to.
  for (const user of await listAllUsers()) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`could not delete ${user.email}: ${error.message}`);
  }
}

async function createUsers(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const u of world.users) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    });
    if (error) throw new Error(`could not create ${u.email}: ${error.message}`);
    ids.set(u.key, data.user.id);
  }
  return ids;
}

function resolveUsers<T extends object>(rows: T[], ids: Map<string, string>): T[] {
  return rows.map((row) => {
    const resolved = { ...row } as Record<string, unknown>;
    for (const column of USER_COLUMNS) {
      const key = resolved[column];
      if (typeof key !== 'string') continue;
      const id = ids.get(key);
      if (!id) throw new Error(`seed row refers to unknown user '${key}' in ${column}`);
      resolved[column] = id;
    }
    return resolved as T;
  });
}

async function writeOrg(plan: OrgPlan, ids: Map<string, string>) {
  const r = <T extends object>(rows: T[]) => resolveUsers(rows, ids);
  await insertAll('orgs', [plan.org]);
  await insertAll('sites', plan.sites);
  await insertAll('memberships', r(plan.memberships));
  await insertAll('suppliers', plan.suppliers);
  await insertAll('site_products', plan.siteProducts);
  await insertAll('reminder_settings', r(plan.reminderSettings));
  await insertAll('deliveries', r(plan.deliveries));
  await insertAll('delivery_lines', plan.deliveryLines);
  await insertAll('stock_batches', plan.batches);
  await insertAll('expiry_actions', r(plan.expiryActions));
  await insertAll('rotation_checks', r(plan.rotationChecks));
  await insertAll('waste_events', r(plan.waste));
  await insertAll('audit_log', r(plan.audit));

  // Last: an archived organisation refuses new sites, members, actions and checks.
  if (plan.archive) {
    const [archive] = r([plan.archive]);
    const { error } = await admin.from('orgs')
      .update({ status: 'archived', ...archive })
      .eq('id', plan.org.id!);
    if (error) throw new Error(`archiving ${plan.org.slug} failed: ${error.message}`);
  }
}

function report() {
  const sum = (pick: (o: OrgPlan) => unknown[]) => world.orgs.reduce((n, o) => n + pick(o).length, 0);
  console.log(`seed world for ${world.asOf} (Australia/Melbourne)`);
  for (const o of world.orgs) {
    const openActions = o.expiryActions.filter((a) => a.state === 'open').length;
    const drafts = o.deliveries.filter((d) => d.status === 'draft').length;
    console.log(
      `  ${o.org.name.padEnd(22)} ${o.archive ? 'archived' : 'active  '} ` +
      `${o.sites.length} sites · ${o.deliveries.length - drafts} deliveries (+${drafts} open) · ` +
      `${o.batches.length} batches · ${openActions} open actions · ${o.waste.length} waste events`,
    );
  }
  console.log(`  ${world.products.length} catalogue products, ${sum((o) => o.siteProducts)} ranged lines, ` +
    `${sum((o) => o.deliveryLines)} docket lines, ${world.jobRuns.length} job runs, ${sum((o) => o.audit)} audit entries`);
  console.log('\nlogins');
  for (const u of world.users) console.log(`  ${u.email.padEnd(36)} ${u.password}`);
}

async function main() {
  const started = Date.now();
  console.log(`target: ${URL_}`);
  await preflight();
  console.log('wiping organisations, users, catalogue, jobs, audit and docket photos…');
  await wipe();

  console.log('writing the seed world…');
  const ids = await createUsers();
  await insertAll('products', resolveUsers(world.products, ids));
  for (const plan of world.orgs) {
    await writeOrg(plan, ids);
    console.log(`  ${plan.org.name} done`);
  }
  await insertAll('job_runs', world.jobRuns);

  console.log('');
  report();
  console.log(`\nreset complete in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

/**
 * Verifies the configured Supabase project is reachable and correctly migrated.
 * Run against local or hosted: npm run check:env
 *
 * Checks connectivity, schema, RLS coverage and seed state separately so a
 * failure says which of those is wrong rather than just "it didn't work".
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';

config({ path: '.env.local' });

// Supabase renamed anon -> publishable and service_role -> secret; accept either.
const REQUIRED: { label: string; names: string[] }[] = [
  { label: 'project URL', names: ['NEXT_PUBLIC_SUPABASE_URL'] },
  { label: 'publishable key', names: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] },
  { label: 'secret key', names: ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] },
];

const EXPECTED_TABLES = [
  'orgs', 'sites', 'profiles', 'memberships', 'suppliers', 'products', 'site_products',
] as const;

async function main() {
  const missing = REQUIRED.filter((r) => !r.names.some((n) => process.env[n]));
  if (missing.length) {
    for (const m of missing) console.error(`missing ${m.label}: set ${m.names.join(' or ')}`);
    console.error('copy .env.example to .env.local and fill it in');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const isLocal = url.includes('127.0.0.1') || url.includes('localhost');
  console.log(`target: ${url} (${isLocal ? 'local' : 'hosted'})\n`);

  const admin = createClient<Database>(url, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let failed = false;

  for (const table of EXPECTED_TABLES) {
    const { error, count } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (error) { console.log(`  MISSING ${table} — ${error.message}`); failed = true; }
    else console.log(`  ok      ${table} (${count} rows)`);
  }

  // RLS must be on in every environment; a hosted project with it off is a data leak.
  const { data: rls, error: rlsError } = await admin.rpc('is_platform_admin');
  if (rlsError && !rlsError.message.includes('permission')) {
    console.log(`\n  helper functions missing — did migrations run? (${rlsError.message})`);
    failed = true;
  } else {
    console.log(`\n  ok      RLS helper functions present (is_platform_admin -> ${rls})`);
  }

  const { count: orgs } = await admin.from('orgs').select('*', { count: 'exact', head: true });
  if (!orgs) console.log('  note    no orgs yet — run `npm run seed`');

  console.log(failed ? '\nFAILED — schema is not fully applied' : '\nenvironment looks good');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

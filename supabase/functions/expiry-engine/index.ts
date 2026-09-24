// Nightly expiry engine. Scheduled at 02:00 Australia/Melbourne.
//
// This file is deliberately thin. Every decision it makes lives in
// src/lib/expiry/engine.ts, which is plain TypeScript covered by `npm test` — the rules
// are testable even though this wrapper is not runnable outside Deno.
//
// Deploy:  supabase functions deploy expiry-engine
// Schedule: supabase/config.toml, or a pg_cron job calling it over HTTP.

import { createClient } from '@supabase/supabase-js';
import {
  HORIZON_DAYS,
  planExpiryActions,
  planRotationChecks,
  type BatchRow,
  type FixtureRow,
  type JobResult,
} from '../_shared/engine.ts';
import { effectiveTrackingMode } from '../_shared/tracking.ts';
import { fetchAllPages } from '../_shared/pagination.ts';

const JOB = 'expiry-engine';
const SITE_TIMEZONE = 'Australia/Melbourne';
const WRITE_CHUNK_SIZE = 500;

function chunks<T>(rows: T[], size = WRITE_CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

/**
 * "Today" has to be the store's today, not UTC's. A run at 02:00 Melbourne is still the
 * previous day in UTC for most of the year, and using the UTC date would shift the whole
 * ladder by one — pulling stock a day late, every day, invisibly.
 */
function todayAt(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (request: Request) => {
  const started = Date.now();

  // The function is reachable from the internet, so a scheduled run has to prove it is
  // one. Without this, anyone could churn every tenant's action list on demand.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const result: JobResult = { ok: true, processed: 0, skipped: 0, reason: null };

  try {
    const today = todayAt(SITE_TIMEZONE);

    // Service-role clients bypass RLS. Join lifecycle scope in the database and page
    // every result so PostgREST's max_rows cap cannot silently omit organisations.
    const batches = await fetchAllPages<{
      id: string;
      org_id: string;
      site_id: string;
      expiry_date: string | null;
    }>((from, to) =>
      supabase
        .from('stock_batches')
        .select('id, org_id, site_id, expiry_date, orgs!inner(status)')
        .eq('orgs.status', 'active')
        .eq('status', 'active')
        .gt('qty_remaining', 0)
        .not('expiry_date', 'is', null)
        .order('id')
        .range(from, to)
    );

    const rows: BatchRow[] = batches.map((b) => ({
      id: b.id,
      orgId: b.org_id,
      siteId: b.site_id,
      expiryDate: b.expiry_date,
    }));

    const planned = planExpiryActions(rows, today);
    result.skipped = rows.length - planned.length;

    // Delete and regenerate rather than diff. A few thousand rows recompute in
    // milliseconds and the result is always correct; incremental flag-juggling is where
    // this kind of job goes quietly wrong. Only OPEN rows go — done and dismissed rows
    // are history, and the partial unique index means a survivor would block its batch.
    const { error: clearError } = await supabase.rpc('clear_active_expiry_actions');
    if (clearError) throw clearError;

    if (planned.length > 0) {
      for (const page of chunks(planned)) {
        const { data: inserted, error: insertError } = await supabase.rpc(
          'insert_active_expiry_actions',
          {
            p_actions: page.map((p) => ({
              org_id: p.orgId,
              site_id: p.siteId,
              batch_id: p.batchId,
              action: p.action,
              due_date: p.dueDate,
            })),
          },
        );
        if (insertError) throw insertError;
        result.processed += Number(inserted ?? 0);
      }
    }

    // Rotation stock carries no dates, so its whole mechanism is the daily fixture list.
    const ranged = await fetchAllPages<{
      org_id: string;
      site_id: string;
      fixture: string | null;
      tracking_mode_override: 'rotation' | 'batch' | 'none' | null;
      products:
        | { tracking_mode: 'rotation' | 'batch' | 'none' }
        | { tracking_mode: 'rotation' | 'batch' | 'none' }[]
        | null;
    }>((from, to) =>
      supabase
        .from('site_products')
        .select('org_id, site_id, fixture, tracking_mode_override, products(tracking_mode), orgs!inner(status)')
        .eq('orgs.status', 'active')
        .eq('active', true)
        .not('fixture', 'is', null)
        .order('id')
        .range(from, to)
    );

    const fixtures: FixtureRow[] = ranged
      .filter((r) => {
        const product = Array.isArray(r.products) ? r.products[0] : r.products;
        const catalogueMode = product?.tracking_mode;
        if (!catalogueMode) return false;
        return effectiveTrackingMode(catalogueMode, r.tracking_mode_override) === 'rotation';
      })
      .map((r) => ({ orgId: r.org_id, siteId: r.site_id, fixture: r.fixture! }));

    const checks = planRotationChecks(fixtures, today);
    if (checks.length > 0) {
      // Upsert, not insert: a re-run on the same day must not wipe the ticks staff have
      // already made, and the unique index on (site_id, fixture, check_date) enforces it.
      // The RPC also locks each organisation and skips rows whose org is no longer active.
      for (const page of chunks(checks)) {
        const { error: checkError } = await supabase.rpc('upsert_active_rotation_checks', {
          p_checks: page.map((c) => ({
            org_id: c.orgId,
            site_id: c.siteId,
            fixture: c.fixture,
            check_date: c.checkDate,
          })),
        });
        if (checkError) throw checkError;
      }
    }

    result.reason = `${planned.length} actions, ${checks.length} rotation checks, horizon ${HORIZON_DAYS}d`;
  } catch (error) {
    result.ok = false;
    result.reason = error instanceof Error ? error.message : String(error);
  }

  // Always write the run, success or failure. A cron that silently stopped firing is the
  // failure mode that costs the most, because nothing looks broken until stock is gone.
  await supabase.from('job_runs').insert({
    job: JOB,
    ok: result.ok,
    processed: result.processed,
    skipped: result.skipped,
    reason: result.reason,
    duration_ms: Date.now() - started,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
});

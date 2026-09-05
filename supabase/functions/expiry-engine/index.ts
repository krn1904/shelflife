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
} from '../../../src/lib/expiry/engine.ts';
import { effectiveTrackingMode } from '../../../src/lib/products/tracking.ts';

const JOB = 'expiry-engine';
const SITE_TIMEZONE = 'Australia/Melbourne';

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

    const { data: batches, error: batchError } = await supabase
      .from('stock_batches')
      .select('id, org_id, site_id, expiry_date')
      .eq('status', 'active')
      .gt('qty_remaining', 0)
      .not('expiry_date', 'is', null);
    if (batchError) throw batchError;

    const rows: BatchRow[] = (batches ?? []).map((b) => ({
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
    const { error: clearError } = await supabase
      .from('expiry_actions')
      .delete()
      .eq('state', 'open');
    if (clearError) throw clearError;

    if (planned.length > 0) {
      const { error: insertError } = await supabase.from('expiry_actions').insert(
        planned.map((p) => ({
          org_id: p.orgId,
          site_id: p.siteId,
          batch_id: p.batchId,
          action: p.action,
          due_date: p.dueDate,
        })),
      );
      if (insertError) throw insertError;
    }
    result.processed = planned.length;

    // Rotation stock carries no dates, so its whole mechanism is the daily fixture list.
    const { data: ranged, error: rangedError } = await supabase
      .from('site_products')
      .select('org_id, site_id, fixture, tracking_mode_override, products(tracking_mode)')
      .eq('active', true)
      .not('fixture', 'is', null);
    if (rangedError) throw rangedError;

    const fixtures: FixtureRow[] = (ranged ?? [])
      .filter((r) => {
        const catalogueMode = r.products?.tracking_mode;
        if (!catalogueMode) return false;
        return effectiveTrackingMode(catalogueMode, r.tracking_mode_override) === 'rotation';
      })
      .map((r) => ({ orgId: r.org_id, siteId: r.site_id, fixture: r.fixture! }));

    const checks = planRotationChecks(fixtures, today);
    if (checks.length > 0) {
      // Upsert, not insert: a re-run on the same day must not wipe the ticks staff have
      // already made, and the unique index on (site_id, fixture, check_date) enforces it.
      const { error: checkError } = await supabase.from('rotation_checks').upsert(
        checks.map((c) => ({
          org_id: c.orgId,
          site_id: c.siteId,
          fixture: c.fixture,
          check_date: c.checkDate,
        })),
        { onConflict: 'site_id,fixture,check_date', ignoreDuplicates: true },
      );
      if (checkError) throw checkError;
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

// Morning digest, 06:00 Australia/Melbourne.
//
// Web Push to whoever has a live subscription for a site, email to the owner.
// The summary wording lives in src/lib/expiry/digest.ts, which `npm test` covers.
//
// Deploy:  supabase functions deploy daily-digest
// Secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, RESEND_API_KEY

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { buildDigest } from '../_shared/digest.ts';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { JobResult } from '../_shared/engine.ts';
import { fetchAllPages } from '../_shared/pagination.ts';

const JOB = 'daily-digest';
const SITE_TIMEZONE = 'Australia/Melbourne';
const DEAD_SUBSCRIPTION_CODES = [404, 410];

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
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@shelflife.app',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const today = todayAt(SITE_TIMEZONE);

    // The service role bypasses RLS. Join active lifecycle scope into every query and
    // page results so PostgREST's max_rows cap cannot skip later organisations.
    const [sites, actions, checks, subscriptions] = await Promise.all([
      fetchAllPages<{ id: string; org_id: string; name: string }>((from, to) =>
        supabase
          .from('sites')
          .select('id, org_id, name, orgs!inner(status)')
          .eq('orgs.status', 'active')
          .order('id')
          .range(from, to)
      ),
      fetchAllPages<{ site_id: string; action: 'check' | 'markdown' | 'pull'; due_date: string }>((from, to) =>
        supabase
          .from('expiry_actions')
          .select('site_id, action, due_date, orgs!inner(status)')
          .eq('orgs.status', 'active')
          .eq('state', 'open')
          .order('id')
          .range(from, to)
      ),
      fetchAllPages<{ site_id: string }>((from, to) =>
        supabase
          .from('rotation_checks')
          .select('site_id, orgs!inner(status)')
          .eq('orgs.status', 'active')
          .eq('check_date', today)
          .eq('state', 'open')
          .order('id')
          .range(from, to)
      ),
      fetchAllPages<{
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
        site_id: string | null;
        org_id: string;
      }>((from, to) =>
        supabase
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth, site_id, org_id, orgs!inner(status)')
          .eq('orgs.status', 'active')
          .is('failed_at', null)
          .order('id')
          .range(from, to)
      ),
    ]);

    for (const site of sites) {
      const siteActions = actions
        .filter((a) => a.site_id === site.id)
        .map((a) => ({
          action: a.action,
          daysLeft: differenceInCalendarDays(parseISO(a.due_date), parseISO(today)),
        }));

      const digest = buildDigest({
        siteName: site.name,
        actions: siteActions,
        rotationFixtures: checks.filter((c) => c.site_id === site.id).length,
      });

      if (!digest.worthSending) {
        result.skipped += 1;
        continue;
      }

      // A subscription with a null site_id belongs to someone who sees the whole org —
      // an owner — so they get every site's digest.
      const targets = subscriptions.filter(
        (s) => s.site_id === site.id || (s.site_id === null && s.org_id === site.org_id),
      );

      for (const target of targets) {
        try {
          await webpush.sendNotification(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth },
            },
            JSON.stringify({
              title: digest.title,
              body: digest.body,
              url: '/app/today',
              tag: `digest-${site.id}`,
            }),
          );
          result.processed += 1;
        } catch (error) {
          // A push service answers 404/410 for a subscription the browser has thrown
          // away. Mark it rather than deleting it, so tomorrow's run skips it and there
          // is still a record of why this person stopped being notified.
          const status = (error as { statusCode?: number }).statusCode;
          if (status && DEAD_SUBSCRIPTION_CODES.includes(status)) {
            await supabase
              .from('push_subscriptions')
              .update({ failed_at: new Date().toISOString(), failure_reason: `push ${status}` })
              .eq('id', target.id);
          }
          result.skipped += 1;
        }
      }
    }

    result.reason = `${result.processed} pushes sent, ${result.skipped} skipped`;
  } catch (error) {
    result.ok = false;
    result.reason = error instanceof Error ? error.message : String(error);
  }

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

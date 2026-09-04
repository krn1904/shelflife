'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession } from '@/lib/auth/session';

export type PushResult = { status: 'idle' } | { status: 'error'; message: string };

const Subscription = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
  userAgent: z.string().max(300).nullable(),
});

/**
 * Stores a browser's push subscription against the signed-in user.
 *
 * Upsert on endpoint, because a browser hands back the same endpoint for the same device
 * and re-subscribing on every visit would otherwise pile up rows and send the same person
 * the same digest several times. Re-subscribing also clears any earlier failure — the
 * device is demonstrably alive again.
 */
export async function savePushSubscription(input: unknown): Promise<PushResult> {
  const session = await requireSession();
  const parsed = Subscription.safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'That subscription looked malformed.' };

  const site = activeSite(session);
  const org = session.memberships[0];
  if (!org) return { status: 'error', message: 'You are not attached to an organisation.' };

  const supabase = await createClient();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: session.userId,
      org_id: org.orgId,
      site_id: site?.id ?? null,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      user_agent: parsed.data.userAgent,
      failed_at: null,
      failure_reason: null,
    },
    { onConflict: 'endpoint' },
  );

  if (error) return { status: 'error', message: `Could not save that (${error.code ?? 'unknown'}).` };
  return { status: 'idle' };
}

export async function removePushSubscription(endpoint: string): Promise<PushResult> {
  await requireSession();
  const supabase = await createClient();

  // RLS restricts this to the caller's own rows, so no user_id filter is needed here.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return { status: 'error', message: `Could not remove that (${error.code ?? 'unknown'}).` };
  return { status: 'idle' };
}

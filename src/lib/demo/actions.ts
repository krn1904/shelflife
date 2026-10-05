'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession, homePathFor } from '@/lib/auth/session';
import { DEMO_ORG_SLUG, DEMO_PASSWORD, oneClickLogin } from '@/lib/demo/config';

export type DemoState = { status: 'idle' } | { status: 'error'; message: string };

/** Whether demo mode is on at all. Off by default, so a real deployment never grows a back door. */
export async function demoEnabled(): Promise<boolean> {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

/**
 * One-click sign-in as a demo role.
 *
 * The password is a published constant and these accounts hold nothing real, but the
 * action still refuses unless demo mode is switched on and the email is one of the
 * one-click logins (never the platform admin) — an env flag is the difference between a portfolio piece and an open door.
 */
export async function signInAsDemo(_prev: DemoState, formData: FormData): Promise<DemoState> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return { status: 'error', message: 'Demo mode is not enabled on this deployment.' };
  }

  const email = String(formData.get('email') ?? '');
  const login = oneClickLogin(email);
  if (!login) return { status: 'error', message: 'That is not a demo account.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: login.email,
    password: DEMO_PASSWORD,
  });

  if (error) {
    return { status: 'error', message: 'The demo data has not been seeded on this deployment yet.' };
  }

  revalidatePath('/', 'layout');
  redirect(homePathFor(login.role));
}

/**
 * Moves the demo tenant's clock forward so a visitor can watch the expiry engine fire
 * without waiting a week.
 *
 * The engine is never told any of this. It runs on whatever dates it finds, which is what
 * makes the demo evidence rather than theatre. The database function refuses outright on
 * an org not flagged is_demo, so the guard does not depend on this code being right.
 */
export async function jumpDemoDays(days: number): Promise<DemoState> {
  const session = await requireSession();

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return { status: 'error', message: 'Demo mode is not enabled on this deployment.' };
  }

  const demoOrg = session.memberships.find((m) => m.orgSlug === DEMO_ORG_SLUG);
  if (!demoOrg) return { status: 'error', message: 'You are not in the demo organisation.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('demo_jump_days', {
    p_org_id: demoOrg.orgId,
    p_days: days,
  });

  if (error) return { status: 'error', message: error.message };

  revalidatePath('/', 'layout');
  return { status: 'idle' };
}

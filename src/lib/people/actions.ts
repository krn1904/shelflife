'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/session';
import { canManageRole } from './rules';

export type AddPersonState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'created'; email: string; tempPassword: string; at: number }
  | { status: 'linked'; email: string; at: number };

const NewPerson = z.object({
  site_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  full_name: z.string().trim().min(2, { message: 'Enter their name.' }).max(120),
  role: z.enum(['staff', 'manager']),
});

/** A readable one-time password, shown once, for the person to change after signing in. */
function tempPassword(): string {
  return `sl-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** An existing login's id by email, paging past the default page size. Not exported: not an action. */
async function findUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
}

/**
 * Adds a staff member (or, for owners, a manager) to one site: creates their login with a
 * temporary password, or links an existing login that belongs to no other organisation.
 *
 * Authorised before the service key is touched: the site must be one this person can see and
 * the role one they manage. add_site_member() then re-checks everything as the database's
 * authority; if it refuses, a login created a moment ago is deleted again.
 */
export async function addSiteMember(_prev: AddPersonState, formData: FormData): Promise<AddPersonState> {
  const session = await requireRole('manager');

  const parsed = NewPerson.safeParse({
    site_id: String(formData.get('site_id') ?? ''),
    email: String(formData.get('email') ?? ''),
    full_name: String(formData.get('full_name') ?? ''),
    role: formData.get('role') ?? 'staff',
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'That did not look right.' };
  const { site_id, email, full_name, role } = parsed.data;

  if (!session.sites.some((s) => s.id === site_id)) {
    return { status: 'error', message: 'That site is not one of yours.' };
  }
  if (!canManageRole(session.primaryRole, role)) {
    return { status: 'error', message: 'Only the owner can add a manager.' };
  }

  const admin = createAdminClient();
  const password = tempPassword();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  const isNew = !created.error;
  const userId = created.data.user?.id ?? (await findUserByEmail(admin, email));
  if (!userId) return { status: 'error', message: 'Could not create a login for that email.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('add_site_member', {
    p_user_id: userId,
    p_site_id: site_id,
    p_role: role,
    p_email: email,
  });

  if (error) {
    if (isNew) await admin.auth.admin.deleteUser(userId);
    if (error.code === '23505') return { status: 'error', message: 'That person already works in this organisation.' };
    // Same words whatever the reason, so this screen doesn't reveal which emails have
    // accounts elsewhere on ShelfLife.
    return {
      status: 'error',
      message: 'That email can’t be added here. If they already use ShelfLife with another business, ask your ShelfLife admin.',
    };
  }

  refresh();
  return isNew
    ? { status: 'created', email, tempPassword: password, at: Date.now() }
    : { status: 'linked', email, at: Date.now() };
}

/**
 * Takes away someone's access to the site. Their login stays (their past work stays
 * attributed, and they can be added back); remove_site_member() decides who may do this.
 */
export async function removeSiteMember(formData: FormData): Promise<void> {
  await requireRole('manager');
  const id = z.string().uuid().safeParse(String(formData.get('membership_id') ?? ''));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.rpc('remove_site_member', { p_membership_id: id.data });
  refresh();
}

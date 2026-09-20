'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/session';
import type { AppRole } from '@/lib/supabase/types';

// Roles that live at one site. Owners and platform admins are org-wide, so their
// membership carries a null site_id, which auth_site_ids() expands to every site.
const SITE_ROLES: AppRole[] = ['staff', 'manager'];

const role = z.enum(['platform_admin', 'owner', 'manager', 'staff']);

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'That did not look right.';
}

function blank(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/** A readable one-time password shown once at creation, meant to be reset on first sign-in. */
function tempPassword(): string {
  return `sl-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * The whole surface runs under the service key, which bypasses RLS — so this gate and
 * the referential checks below ARE the access boundary, not a convenience on top of one.
 * Every action re-authorises here and re-resolves posted ids against the database.
 */
async function requireAdmin() {
  const session = await requireRole('platform_admin');
  return { session, admin: createAdminClient(), user: await createClient() };
}

function revalidateOrganisation(orgId: string) {
  revalidatePath('/admin');
  revalidatePath(`/admin/organisations/${orgId}`);
}

async function isActiveOrganisation(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('orgs')
    .select('id')
    .eq('id', orgId)
    .eq('status', 'active')
    .maybeSingle();
  return Boolean(data);
}

// ── Organisations ────────────────────────────────────────────────────────

export type OrganisationFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'created';
      orgId: string;
      email: string;
      tempPassword: string | null;
      linkedExisting: boolean;
    };

const NewOrganisation = z.object({
  name: z.string().trim().min(2, { message: 'Give the organisation a name.' }).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, { message: 'Give the organisation a short slug.' })
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Use lowercase letters, numbers and single hyphens only.',
    }),
  site_name: z.string().trim().min(2, { message: 'Give the first site a name.' }).max(120),
  timezone: z.string().trim().min(1).max(60),
  address: z.union([z.null(), z.string().max(200)]),
  owner_name: z.string().trim().min(2, { message: 'Enter the owner’s name.' }).max(120),
  owner_email: z.string().trim().toLowerCase().email({ message: 'Enter a valid owner email.' }),
});

export async function createOrganisation(
  _prev: OrganisationFormState,
  formData: FormData,
): Promise<OrganisationFormState> {
  const { admin, user } = await requireAdmin();
  const parsed = NewOrganisation.safeParse({
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    site_name: String(formData.get('site_name') ?? ''),
    timezone: blank(formData.get('timezone')) ?? 'Australia/Melbourne',
    address: blank(formData.get('address')),
    owner_name: String(formData.get('owner_name') ?? ''),
    owner_email: String(formData.get('owner_email') ?? ''),
  });
  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error) };

  const input = parsed.data;
  const { data: existingOrg } = await admin
    .from('orgs')
    .select('id')
    .eq('slug', input.slug)
    .maybeSingle();
  if (existingOrg) return { status: 'error', message: 'That organisation slug is already in use.' };

  let userId = await findUserByEmail(admin, input.owner_email);
  let createdUser = false;
  const password = tempPassword();

  if (!userId) {
    const created = await admin.auth.admin.createUser({
      email: input.owner_email,
      password,
      email_confirm: true,
      user_metadata: { full_name: input.owner_name },
    });
    userId = created.data.user?.id ?? null;
    if (created.error || !userId) {
      return {
        status: 'error',
        message: `Could not create the owner account: ${created.error?.message ?? 'unknown error'}`,
      };
    }
    createdUser = true;
  }

  const { data: org, error: orgError } = await admin
    .from('orgs')
    .insert({ name: input.name, slug: input.slug })
    .select('id')
    .single();
  if (orgError || !org) {
    const cleanup = createdUser ? await admin.auth.admin.deleteUser(userId) : null;
    return {
      status: 'error',
      message: `${orgError?.code === '23505'
        ? 'That organisation slug is already in use.'
        : `Could not create the organisation (${orgError?.code ?? 'unknown'}).`
      }${cleanup?.error ? ` The unused owner account also needs manual cleanup: ${cleanup.error.message}` : ''}`,
    };
  }

  const rollback = async () => {
    const failures: string[] = [];
    const { error: orgCleanup } = await admin.from('orgs').delete().eq('id', org.id);
    if (orgCleanup) failures.push(`organisation cleanup failed (${orgCleanup.code})`);
    if (createdUser) {
      const { error: userCleanup } = await admin.auth.admin.deleteUser(userId!);
      if (userCleanup) failures.push(`owner cleanup failed (${userCleanup.message})`);
    }
    return failures.length > 0 ? failures.join('; ') : null;
  };

  const { data: site, error: siteError } = await admin
    .from('sites')
    .insert({
      org_id: org.id,
      name: input.site_name,
      timezone: input.timezone,
      address: input.address,
    })
    .select('id')
    .single();
  if (siteError || !site) {
    const cleanupFailure = await rollback();
    return {
      status: 'error',
      message: `Could not create the first site (${siteError?.code ?? 'unknown'}).${
        cleanupFailure ? ` Manual cleanup required: ${cleanupFailure}.` : ''
      }`,
    };
  }

  const { error: membershipError } = await admin.from('memberships').insert({
    user_id: userId,
    org_id: org.id,
    site_id: null,
    role: 'owner',
  });
  if (membershipError) {
    const cleanupFailure = await rollback();
    return {
      status: 'error',
      message: `Could not assign the owner (${membershipError.code ?? 'unknown'}).${
        cleanupFailure ? ` Manual cleanup required: ${cleanupFailure}.` : ''
      }`,
    };
  }

  const { error: auditError } = await user.rpc('write_audit', {
    p_action: 'platform_admin.created_organisation',
    p_org_id: org.id,
    p_site_id: site.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
    p_detail: { name: input.name, slug: input.slug, owner_email: input.owner_email },
  });
  if (auditError) {
    const cleanupFailure = await rollback();
    return {
      status: 'error',
      message: `The required audit entry failed, so organisation creation was reversed.${
        cleanupFailure ? ` Manual cleanup required: ${cleanupFailure}.` : ''
      }`,
    };
  }

  revalidateOrganisation(org.id);
  return {
    status: 'created',
    orgId: org.id,
    email: input.owner_email,
    tempPassword: createdUser ? password : null,
    linkedExisting: !createdUser,
  };
}

export type OrganisationLifecycleState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'archived' }
  | { status: 'restored' };

const OrganisationLifecycle = z.object({
  org_id: z.string().uuid(),
  confirm_slug: z.string().trim().toLowerCase(),
});

export async function archiveOrganisation(
  _prev: OrganisationLifecycleState,
  formData: FormData,
): Promise<OrganisationLifecycleState> {
  const { session, admin, user } = await requireAdmin();
  const parsed = OrganisationLifecycle.safeParse({
    org_id: String(formData.get('org_id') ?? ''),
    confirm_slug: String(formData.get('confirm_slug') ?? ''),
  });
  if (!parsed.success) return { status: 'error', message: 'The confirmation was not valid.' };

  const { data: org } = await admin
    .from('orgs')
    .select('id, slug, status')
    .eq('id', parsed.data.org_id)
    .maybeSingle();
  if (!org) return { status: 'error', message: 'That organisation no longer exists.' };
  if (org.status === 'archived') return { status: 'archived' };
  if (parsed.data.confirm_slug !== org.slug) {
    return { status: 'error', message: `Type ${org.slug} exactly to confirm.` };
  }

  const { error } = await admin
    .from('orgs')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      archived_by: session.userId,
    })
    .eq('id', org.id);
  if (error) return { status: 'error', message: `Could not archive the organisation (${error.code}).` };

  const { error: auditError } = await user.rpc('write_audit', {
    p_action: 'platform_admin.archived_organisation',
    p_org_id: org.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
  });
  if (auditError) {
    const { error: rollbackError } = await admin
      .from('orgs')
      .update({ status: 'active', archived_at: null, archived_by: null })
      .eq('id', org.id);
    return {
      status: 'error',
      message: rollbackError
        ? 'The organisation was archived, but its audit entry failed. Contact support before retrying.'
        : 'The required audit entry failed, so the archive was reversed.',
    };
  }

  revalidateOrganisation(org.id);
  return { status: 'archived' };
}

export async function restoreOrganisation(
  _prev: OrganisationLifecycleState,
  formData: FormData,
): Promise<OrganisationLifecycleState> {
  const { admin, user } = await requireAdmin();
  const orgId = z.string().uuid().safeParse(String(formData.get('org_id') ?? ''));
  if (!orgId.success) return { status: 'error', message: 'The organisation was not valid.' };

  const { data: org } = await admin
    .from('orgs')
    .select('id, status, archived_at, archived_by')
    .eq('id', orgId.data)
    .maybeSingle();
  if (!org) return { status: 'error', message: 'That organisation no longer exists.' };
  if (org.status === 'active') return { status: 'restored' };

  const { error } = await admin
    .from('orgs')
    .update({ status: 'active', archived_at: null, archived_by: null })
    .eq('id', org.id);
  if (error) return { status: 'error', message: `Could not restore the organisation (${error.code}).` };

  const { error: auditError } = await user.rpc('write_audit', {
    p_action: 'platform_admin.restored_organisation',
    p_org_id: org.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
  });
  if (auditError) {
    const { error: rollbackError } = await admin
      .from('orgs')
      .update({
        status: 'archived',
        archived_at: org.archived_at ?? new Date().toISOString(),
        archived_by: org.archived_by,
      })
      .eq('id', org.id);
    return {
      status: 'error',
      message: rollbackError
        ? 'The organisation was restored, but its audit entry failed. Contact support before retrying.'
        : 'The required audit entry failed, so the restore was reversed.',
    };
  }

  revalidateOrganisation(org.id);
  return { status: 'restored' };
}

// ── Sites ────────────────────────────────────────────────────────────────

export type SiteFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'created'; siteId: string };

const NewSite = z.object({
  org_id: z.string().uuid(),
  name: z.string().trim().min(2, { message: 'Give the site a name.' }).max(120),
  timezone: z.string().trim().min(1).max(60),
  address: z.union([z.null(), z.string().max(200)]),
});

export async function createSite(_prev: SiteFormState, formData: FormData): Promise<SiteFormState> {
  const { admin, user } = await requireAdmin();

  const parsed = NewSite.safeParse({
    org_id: String(formData.get('org_id') ?? ''),
    name: String(formData.get('name') ?? ''),
    timezone: blank(formData.get('timezone')) ?? 'Australia/Melbourne',
    address: blank(formData.get('address')),
  });
  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error) };

  if (!(await isActiveOrganisation(admin, parsed.data.org_id))) {
    return { status: 'error', message: 'That organisation is archived or no longer exists.' };
  }

  const { data, error } = await admin.from('sites').insert(parsed.data).select('id').single();
  if (error) return { status: 'error', message: `Could not create the site (${error.code ?? 'unknown'}).` };

  await user.rpc('write_audit', {
    p_action: 'platform_admin.created_site',
    p_org_id: parsed.data.org_id,
    p_subject_type: 'site',
    p_subject_id: data.id,
    p_detail: { name: parsed.data.name },
  });

  revalidateOrganisation(parsed.data.org_id);
  return { status: 'created', siteId: data.id };
}

/**
 * A site is only removable while it has no history. Deleting one with deliveries, batches
 * or waste events would cascade every one of those rows away — the exact records the
 * product exists to keep — so this refuses and names what stands in the way instead.
 */
export async function removeSite(formData: FormData): Promise<void> {
  const { admin, user } = await requireAdmin();

  const siteId = z.string().uuid().safeParse(String(formData.get('site_id') ?? ''));
  if (!siteId.success) return;

  const { data: site } = await admin
    .from('sites').select('id, org_id').eq('id', siteId.data).maybeSingle();
  if (!site) return;
  if (!(await isActiveOrganisation(admin, site.org_id))) return;

  const [{ count: deliveries }, { count: batches }, { count: waste }] = await Promise.all([
    admin.from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
    admin.from('stock_batches').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
    admin.from('waste_events').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
  ]);

  // A site with any recorded activity is kept. The button is for sites added by mistake.
  if ((deliveries ?? 0) + (batches ?? 0) + (waste ?? 0) > 0) return;

  const { error } = await admin.from('sites').delete().eq('id', site.id);
  if (error) return;

  await user.rpc('write_audit', {
    p_action: 'platform_admin.removed_site',
    p_org_id: site.org_id,
    p_subject_type: 'site',
    p_subject_id: site.id,
  });

  revalidateOrganisation(site.org_id);
}

// ── People ───────────────────────────────────────────────────────────────

export type PersonFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'created'; email: string; tempPassword: string }
  | { status: 'linked'; email: string };

const NewPerson = z.object({
  org_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  full_name: z.string().trim().min(2, { message: 'Enter their name.' }).max(120),
  role,
  site_id: z.union([z.null(), z.string().uuid()]),
});

/**
 * Resolves the site_id a role is allowed to carry. Site roles must name a real site in
 * the org; org-wide roles are forced to null so a stale pin can't survive a promotion.
 */
async function resolveSite(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  role: AppRole,
  siteId: string | null,
): Promise<{ ok: true; siteId: string | null } | { ok: false; message: string }> {
  if (!SITE_ROLES.includes(role)) return { ok: true, siteId: null };
  if (!siteId) return { ok: false, message: 'Staff and managers must be assigned to a site.' };

  const { data: site } = await admin
    .from('sites').select('id').eq('id', siteId).eq('org_id', orgId).maybeSingle();
  if (!site) return { ok: false, message: 'That site is not part of this organisation.' };
  return { ok: true, siteId };
}

/** Finds an existing auth user by email, paging past the default page size. */
async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
}

export async function addPerson(_prev: PersonFormState, formData: FormData): Promise<PersonFormState> {
  const { admin, user } = await requireAdmin();

  const parsed = NewPerson.safeParse({
    org_id: String(formData.get('org_id') ?? ''),
    email: String(formData.get('email') ?? ''),
    full_name: String(formData.get('full_name') ?? ''),
    role: formData.get('role'),
    site_id: blank(formData.get('site_id')),
  });
  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error) };
  const { org_id, email, full_name } = parsed.data;

  if (!(await isActiveOrganisation(admin, org_id))) {
    return { status: 'error', message: 'That organisation is archived or no longer exists.' };
  }

  const site = await resolveSite(admin, org_id, parsed.data.role, parsed.data.site_id);
  if (!site.ok) return { status: 'error', message: site.message };

  // Create the login, or fall back to the existing account for a known email. An existing
  // user keeps their password, so there is no new one to hand back — the state differs.
  const password = tempPassword();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  let userId = created.data.user?.id ?? null;
  const isNew = !created.error;
  if (created.error) {
    userId = await findUserByEmail(admin, email);
    if (!userId) return { status: 'error', message: `Could not create the account: ${created.error.message}` };
  }

  const { error } = await admin
    .from('memberships')
    .insert({ user_id: userId!, org_id, site_id: site.siteId, role: parsed.data.role });

  if (error) {
    // unique (user_id, org_id, site_id) — they already hold this exact membership.
    if (error.code === '23505') {
      return { status: 'error', message: 'That person already has this role here.' };
    }
    return { status: 'error', message: `Could not add the membership (${error.code ?? 'unknown'}).` };
  }

  await user.rpc('write_audit', {
    p_action: isNew ? 'platform_admin.created_user' : 'platform_admin.linked_user',
    p_org_id: org_id,
    p_site_id: site.siteId ?? undefined,
    p_subject_type: 'membership',
    p_detail: { email, role: parsed.data.role },
  });

  revalidateOrganisation(org_id);
  return isNew
    ? { status: 'created', email, tempPassword: password }
    : { status: 'linked', email };
}

const UpdateRole = z.object({
  membership_id: z.string().uuid(),
  role,
  site_id: z.union([z.null(), z.string().uuid()]),
});

export async function updateMemberRole(formData: FormData): Promise<void> {
  const { admin, user } = await requireAdmin();

  const parsed = UpdateRole.safeParse({
    membership_id: String(formData.get('membership_id') ?? ''),
    role: formData.get('role'),
    site_id: blank(formData.get('site_id')),
  });
  if (!parsed.success) return;

  const { data: membership } = await admin
    .from('memberships').select('id, org_id').eq('id', parsed.data.membership_id).maybeSingle();
  if (!membership) return;
  if (!(await isActiveOrganisation(admin, membership.org_id))) return;

  // The site rule applies on update too: a promotion to an org-wide role nulls the pin.
  const site = await resolveSite(admin, membership.org_id, parsed.data.role, parsed.data.site_id);
  if (!site.ok) return;

  const { error } = await admin
    .from('memberships')
    .update({ role: parsed.data.role, site_id: site.siteId })
    .eq('id', membership.id);
  if (error) return;

  await user.rpc('write_audit', {
    p_action: 'platform_admin.updated_role',
    p_org_id: membership.org_id,
    p_site_id: site.siteId ?? undefined,
    p_subject_type: 'membership',
    p_subject_id: membership.id,
    p_detail: { role: parsed.data.role },
  });

  revalidateOrganisation(membership.org_id);
}

/** Unlinks a person from the organisation. The auth login itself is left intact. */
export async function removeMember(formData: FormData): Promise<void> {
  const { admin, user } = await requireAdmin();

  const membershipId = z.string().uuid().safeParse(String(formData.get('membership_id') ?? ''));
  if (!membershipId.success) return;

  const { data: membership } = await admin
    .from('memberships').select('id, org_id').eq('id', membershipId.data).maybeSingle();
  if (!membership) return;
  if (!(await isActiveOrganisation(admin, membership.org_id))) return;

  const { error } = await admin.from('memberships').delete().eq('id', membership.id);
  if (error) return;

  await user.rpc('write_audit', {
    p_action: 'platform_admin.removed_member',
    p_org_id: membership.org_id,
    p_subject_type: 'membership',
    p_subject_id: membership.id,
  });

  revalidateOrganisation(membership.org_id);
}

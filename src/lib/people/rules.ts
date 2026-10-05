import type { AppRole } from '@/lib/supabase/types';

/**
 * Who may add and remove whom at a site, without the platform admin:
 *
 *   owner (or platform admin)  staff or managers, at any site of their organisation
 *   manager                    staff only, at the site they manage
 *   staff                      nobody
 *
 * Owners and platform admins are never added or removed here; that stays with the platform
 * admin. The database applies the same rules (can_manage_site_role in migration
 * 20261005000003); this copy gives a plain message before anything is created.
 */
export function rolesManagedBy(caller: AppRole): AppRole[] {
  switch (caller) {
    case 'platform_admin':
    case 'owner':
      return ['staff', 'manager'];
    case 'manager':
      return ['staff'];
    case 'staff':
      return [];
  }
}

export function canManageRole(caller: AppRole, target: AppRole): boolean {
  return rolesManagedBy(caller).includes(target);
}

/** Whether the Remove button shows: a role you manage, and never yourself. */
export function canRemove(caller: { role: AppRole; userId: string }, target: { role: AppRole; userId: string }): boolean {
  return caller.userId !== target.userId && canManageRole(caller.role, target.role);
}

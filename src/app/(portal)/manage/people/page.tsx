import { activeSite, requireRole } from '@/lib/auth/session';
import { firstParam } from '@/lib/search-params';
import { loadSitePeople } from '@/lib/people/data';
import { removeSiteMember } from '@/lib/people/actions';
import { canRemove, rolesManagedBy } from '@/lib/people/rules';
import { PageHeader } from '@/components/ui';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { AddPersonForm } from './add-person-form';

const ROLE_LABEL = { staff: 'Staff', manager: 'Manager', owner: 'Owner', platform_admin: 'Platform admin' } as const;

/** A site's managers and staff: owners add and remove both, managers add and remove staff. */
export default async function PeoplePage(props: PageProps<'/manage/people'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));

  if (!site) return <PageHeader title="People" subtitle="No site assigned" />;

  const people = await loadSitePeople(site);
  const roles = rolesManagedBy(session.primaryRole);
  const me = { role: session.primaryRole, userId: session.userId };
  // Owners pick which of their sites to manage; a manager has just the one.
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="People"
        subtitle={`Who works at ${site.name}. ${roles.includes('manager') ? 'Add or remove staff and managers.' : 'Add or remove staff.'}`}
      />

      {siteSites.length > 1 && (
        <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/manage/people">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Site</span>
            <select name="site" defaultValue={site.id} className="field w-auto">
              {siteSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-outline">Show</button>
        </form>
      )}

      <ul className="card divide-y divide-line overflow-hidden">
        {people.map((p) => (
          <li key={p.membershipId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <div className="min-w-0">
              <div className="font-medium">
                {p.name}
                {p.userId === session.userId && <span className="text-muted"> (you)</span>}
              </div>
              <div className="truncate text-xs text-faint">{p.email}</div>
            </div>
            <span className="badge badge-brand ml-auto">{ROLE_LABEL[p.role]}</span>
            {canRemove(me, p) && (
              <form action={removeSiteMember}>
                <input type="hidden" name="membership_id" value={p.membershipId} />
                <ConfirmSubmit
                  message={`Remove ${p.name} from ${site.name}? They won't be able to sign in here any more.`}
                  className="btn btn-ghost btn-sm"
                  pendingLabel="Removing…"
                >
                  Remove
                </ConfirmSubmit>
              </form>
            )}
          </li>
        ))}
        {people.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted">Nobody works at {site.name} yet.</li>
        )}
      </ul>

      {/* Keyed by site so switching sites starts a fresh form. */}
      <AddPersonForm key={site.id} siteId={site.id} siteName={site.name} roles={roles} />
    </div>
  );
}

import { redirect } from 'next/navigation';

export default async function LegacyTenantPage(
  props: PageProps<'/admin/tenants/[orgId]'>,
) {
  const { orgId } = await props.params;
  redirect(`/admin/organisations/${orgId}`);
}

import { activeSite, requireSession } from '@/lib/auth/session';
import { firstParam } from '@/lib/search-params';
import { WasteClient } from './waste-client';

export default async function WastePage(props: PageProps<'/app/waste'>) {
  const session = await requireSession();
  const params = await props.searchParams;
  const site = activeSite(session);

  return (
    <WasteClient
      siteId={site?.id ?? null}
      siteName={site?.name ?? null}
      initialBatchId={firstParam(params.batch)}
    />
  );
}

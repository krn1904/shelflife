import { createClient } from '@/lib/supabase/server';

const SHOWN = 5;

/** The last few dockets saved at this site, as the operator confirmed them. */
export async function SavedScans({ siteId }: { siteId: string }) {
  const supabase = await createClient();
  const { data: scans, error } = await supabase
    .from('docket_scans')
    .select('id, supplier_name, docket_number, docket_date, columns, expiry_not_needed, created_at, docket_scan_lines(position, cells, expiry_date)')
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .limit(SHOWN);

  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Saved dockets</h2>
      {error && (
        // Most likely the migration has not been applied to this database yet.
        <p className="mt-2 text-sm text-critical">Could not load saved dockets ({error.code ?? error.message}).</p>
      )}
      {!error && (scans ?? []).length === 0 && (
        <p className="mt-2 text-sm text-muted">None yet. Choose a table above and save it with its expiry dates.</p>
      )}
      <ul className="mt-2 space-y-2">
        {(scans ?? []).map((scan) => {
          const columns = (scan.columns as string[]) ?? [];
          const lines = [...scan.docket_scan_lines].sort((a, b) => a.position - b.position);
          const dated = lines.filter((l) => l.expiry_date).length;
          return (
            <li key={scan.id}>
              <details className="rounded border border-line bg-surface">
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <span className="font-medium">{scan.supplier_name ?? 'Unknown supplier'}</span>
                  {scan.docket_number && <span className="text-muted"> · #{scan.docket_number}</span>}
                  {scan.docket_date && <span className="text-muted"> · {scan.docket_date}</span>}
                  <span className="text-muted">
                    {' '}· {lines.length} lines · {scan.expiry_not_needed ? `no expiry needed (${dated} dated)` : `${dated} dated`}
                    {' '}· saved {new Date(scan.created_at).toLocaleString('en-AU')}
                  </span>
                </summary>
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-max min-w-full text-xs">
                    <thead className="bg-surface-2 text-left text-muted">
                      <tr>
                        {columns.map((c, i) => <th key={i} className="px-2 py-1.5 font-medium">{c}</th>)}
                        <th className="px-2 py-1.5 font-medium text-ink">Expiry date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {lines.map((line) => (
                        <tr key={line.position}>
                          {((line.cells as string[]) ?? []).map((cell, i) => <td key={i} className="px-2 py-1.5">{cell}</td>)}
                          <td className="px-2 py-1.5 font-medium">
                            {line.expiry_date ? new Date(`${line.expiry_date}T00:00:00`).toLocaleDateString('en-AU') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

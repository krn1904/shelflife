/**
 * What a page looks like while its data loads: the shape of the screen in muted blocks, shown
 * the instant a link is tapped so nobody taps it again wondering if it registered.
 */

function Block({ className }: { className: string }) {
  return <div className={`rounded-lg bg-surface-2 motion-safe:animate-pulse ${className}`} />;
}

export function PageSkeleton({
  label,
  stats = 0,
  rows = 5,
}: {
  /** Read out to screen readers, e.g. "Loading your shift". */
  label: string;
  /** Stat tiles across the top, as on the portal dashboards. */
  stats?: number;
  /** List rows in the card below. */
  rows?: number;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-8">
      <span className="sr-only">{label}…</span>
      <div className="space-y-2">
        <Block className="h-7 w-48" />
        <Block className="h-4 w-72 max-w-full" />
      </div>
      {stats > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: stats }, (_, i) => <Block key={i} className="h-20" />)}
        </div>
      )}
      <div className="space-y-3">
        <Block className="h-4 w-32" />
        <div className="card divide-y divide-line overflow-hidden">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Block className="h-4 flex-1" />
              <Block className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

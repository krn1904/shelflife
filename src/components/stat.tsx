export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'brand' | 'critical';
}) {
  const accent =
    tone === 'brand' ? 'text-brand' : tone === 'critical' ? 'text-critical' : 'text-ink';

  return (
    <div className="card p-4">
      <div className="section-title">{label}</div>
      <div className={`mt-1.5 text-3xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

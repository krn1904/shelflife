'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SERIES, TOOLTIP_STYLE, formatAud } from '@/lib/charts/tokens';

export type BarDatum = { label: string; value: number; tone?: string };

/**
 * Horizontal bars for "how much, by category" — the form that reads fastest when the
 * categories have names of unequal length, because the labels run along the reading
 * direction instead of being turned on their side.
 *
 * One series, so there is no legend: the heading names it. Values are direct-labelled,
 * which is also the relief the palette needs where a fill sits under 3:1 on white.
 */
export function HorizontalBars({
  data,
  emptyNote,
  money = true,
}: {
  data: BarDatum[];
  emptyNote: string;
  money?: boolean;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-muted">{emptyNote}</p>;
  }

  // Recharts hands formatters a widened value type, so coerce here rather than lying
  // to TypeScript about the signature.
  const show = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value ?? 0);
    return money ? formatAud(n) : String(n);
  };

  // Category labels are site and reason names of very uneven length, so the axis track is
  // sized to the longest one rather than fixed — a fixed width clips "Coca-Cola
  // Europacific" and leaves acres of gap next to "Other". Capped so one long name cannot
  // squeeze the bars themselves down to nothing.
  const axisWidth = Math.min(
    220,
    Math.max(90, ...data.map((d) => d.label.length * 7 + 16)),
  );

  return (
    <div className="chart" style={{ height: Math.max(140, data.length * 44 + 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={axisWidth}
            tickLine={false}
            axisLine
            tick={{ fontSize: 12 }}
          />
          <Tooltip
            formatter={(value) => [show(value), '']}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
            {/* Keyed by position too: an admin's league holds same-named sites from different organisations. */}
            {data.map((d, i) => (
              <Cell key={`${i}-${d.label}`} fill={d.tone ?? SERIES} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(value) => show(value)}
              style={{ fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

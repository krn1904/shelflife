'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SERIES, TOOLTIP_STYLE, formatAud } from '@/lib/charts/tokens';

export type TrendPoint = { label: string; value: number };

/**
 * Waste in dollars over time. One series, so no legend — the heading names it.
 *
 * Months with no waste arrive as explicit zeroes from wasteByMonth(), which is what stops
 * the line jumping a gap as though it were a trend. `connectNulls` is deliberately absent
 * for the same reason: a hole should look like a hole.
 */
export function TrendChart({ data, emptyNote }: { data: TrendPoint[]; emptyNote: string }) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-muted">{emptyNote}</p>;
  }

  return (
    <div className="chart h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => formatAud(Number(v ?? 0))}
          />
          <Tooltip
            formatter={(value) => [formatAud(Number(value ?? 0)), 'Waste']}
            contentStyle={TOOLTIP_STYLE}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 3, fill: SERIES, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Chart colours, validated rather than chosen by eye.
 *
 * `SERIES` was checked with the dataviz validator against both theme surfaces — light
 * `#ffffff` and dark `#181b1f` — and clears the lightness band, chroma floor and the 3:1
 * contrast gate on each, so one value serves both themes. Every chart here is single-series,
 * so there is no adjacent-pair problem to solve and no legend to draw — the chart title names
 * the one series.
 *
 * Grid, axis, tick and label colours are not set here: they come from the theme tokens
 * through the `.chart` rules in globals.css, so they follow light and dark.
 */

export const SERIES = '#2a78d6';

/** Recharts tooltips are inline-styled HTML, so CSS variables resolve and follow the theme. */
export const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  color: 'var(--ink)',
  border: '1px solid var(--line-strong)',
  borderRadius: 8,
  fontSize: 12,
} as const;

export function formatAud(value: number): string {
  return value.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  });
}

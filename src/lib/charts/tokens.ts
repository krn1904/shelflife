/**
 * Chart colours, validated rather than chosen by eye.
 *
 * `SERIES` was checked with the dataviz validator against this app's actual white
 * surface (not the reference off-white) and clears the lightness band, chroma floor and
 * the 3:1 contrast gate. Every chart here is single-series, so there is no adjacent-pair
 * problem to solve and no legend to draw — the chart title names the one series.
 *
 * STATUS is the fixed status palette. On white, `warning` (1.83:1) and `serious` (2.64:1)
 * sit below 3:1, so they are used as block accents beside a written label and never as
 * text and never as the only thing distinguishing one row from another.
 */

export const SERIES = '#2a78d6';

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export const CHART_INK = {
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
} as const;

export function formatAud(value: number): string {
  return value.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  });
}

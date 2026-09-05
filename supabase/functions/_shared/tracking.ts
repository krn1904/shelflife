// Declared here rather than imported from the app's generated types: _shared must not
// depend on anything outside supabase/functions, or the bundler is back where it started.
export type TrackingMode = 'rotation' | 'batch' | 'none';

export const TRACKING_MODES: readonly TrackingMode[] = ['rotation', 'batch', 'none'];

export const TRACKING_LABEL: Record<TrackingMode, string> = {
  rotation: 'Rotation',
  batch: 'Batch',
  none: 'Not tracked',
};

export const TRACKING_HINT: Record<TrackingMode, string> = {
  rotation: 'Rotated by eye on a daily fixture list. No expiry captured at intake.',
  batch: 'One expiry per docket line. Surfaces at 30, 14, 7, 3 and 1 days out.',
  none: 'Quantity only. Never surfaced for expiry.',
};

/**
 * The catalogue's mode is a sensible default, not a rule: the same SKU can be a daily
 * rotation item at a busy site and a batch item at a quiet one. A site override wins
 * whenever it is set — including when it is set to a *less* strict mode.
 */
export function effectiveTrackingMode(
  catalogueMode: TrackingMode,
  siteOverride: TrackingMode | null | undefined,
): TrackingMode {
  return siteOverride ?? catalogueMode;
}

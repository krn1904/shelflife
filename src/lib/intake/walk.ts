/**
 * Moving through the delivery one line at a time. Kept apart from the component so the
 * edges — an empty delivery, a line removed under the cursor — are tested, not hoped for.
 */

/** The line `delta` steps from `at`, held inside the delivery. */
export function stepLine(at: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, at + delta));
}

/** Where the cursor stands, as staff read it: "Line 4 of 9". Null with no lines at all. */
export function linePosition(at: number, total: number): { line: number; of: number; last: boolean } | null {
  if (total <= 0) return null;
  const index = stepLine(at, 0, total);
  return { line: index + 1, of: total, last: index === total - 1 };
}

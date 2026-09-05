import type { WasteReason } from '@/lib/supabase/types';

// Kept out of actions.ts deliberately: every export of a 'use server' module must be an
// async function, so a plain constant cannot live there.
export const WASTE_REASONS: readonly WasteReason[] = [
  'expired',
  'damaged',
  'spoiled',
  'recalled',
  'staff_error',
  'other',
];

export const WASTE_REASON_LABEL: Record<WasteReason, string> = {
  expired: 'Expired',
  damaged: 'Damaged',
  spoiled: 'Spoiled',
  recalled: 'Recalled',
  staff_error: 'Staff error',
  other: 'Other',
};

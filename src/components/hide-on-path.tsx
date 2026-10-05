'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Renders its children everywhere except on one page, e.g. a summary that page already shows in full. */
export function HideOnPath({ path, children }: { path: string; children: ReactNode }) {
  return usePathname() === path ? null : children;
}

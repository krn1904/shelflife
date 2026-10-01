'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * A submit button that disables itself while its form's action runs, so a second tap on a
 * slow connection cannot send the same change twice.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}

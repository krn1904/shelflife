'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button that asks first, for actions that are hard to undo. Disabled while its form runs. */
export function ConfirmSubmit({
  message,
  children,
  pendingLabel,
  className,
}: {
  message: string;
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}

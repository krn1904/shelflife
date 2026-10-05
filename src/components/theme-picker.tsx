'use client';

import { useState } from 'react';
import { themeCookie, type ThemeChoice } from '@/lib/theme/theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Writes the choice where the next server render and this page both read it. */
function applyTheme(choice: ThemeChoice) {
  document.cookie = themeCookie(choice);
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

/**
 * System / Light / Dark. A choice writes the cookie (so the next server render matches) and
 * flips the attribute on <html> at once; "System" removes both and CSS follows the device.
 * Nothing listens or polls afterwards.
 */
export function ThemePicker({ initial, compact = false }: { initial: ThemeChoice; compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex rounded-[var(--radius)] border border-line bg-surface p-0.5 ${compact ? 'text-xs' : 'text-sm'}`}
    >
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={choice === c.value}
          onClick={() => pick(c.value)}
          className={`rounded-[calc(var(--radius)-2px)] font-semibold transition ${
            compact ? 'min-h-8 px-2.5' : 'min-h-10 px-4'
          } ${choice === c.value ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

import type { ExpiryActionKind } from './engine';

/**
 * Turns a site's open actions into the one line a phone notification gets to show.
 *
 * A notification is read in about a second on a lock screen, so it has to lead with the
 * thing that costs money if ignored. Counts, not product names: naming one item when
 * eleven need pulling is worse than naming none.
 */

export type DigestInput = {
  siteName: string;
  actions: { action: ExpiryActionKind; daysLeft: number }[];
  rotationFixtures: number;
};

export type Digest = {
  siteName: string;
  pull: number;
  markdown: number;
  check: number;
  overdue: number;
  rotationFixtures: number;
  title: string;
  body: string;
  /** Nothing to say is a real outcome — a daily "all clear" trains people to ignore it. */
  worthSending: boolean;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildDigest(input: DigestInput): Digest {
  const pull = input.actions.filter((a) => a.action === 'pull').length;
  const markdown = input.actions.filter((a) => a.action === 'markdown').length;
  const check = input.actions.filter((a) => a.action === 'check').length;
  const overdue = input.actions.filter((a) => a.daysLeft < 0).length;

  const parts: string[] = [];
  if (pull > 0) parts.push(`${plural(pull, 'line', 'lines')} to pull`);
  if (markdown > 0) parts.push(`${plural(markdown, 'line', 'lines')} to mark down`);
  if (check > 0) parts.push(`${plural(check, 'line', 'lines')} to check`);
  if (input.rotationFixtures > 0) {
    parts.push(`${plural(input.rotationFixtures, 'fixture', 'fixtures')} to walk`);
  }

  // The title carries the urgent number so it survives truncation on a lock screen.
  const title =
    pull > 0
      ? `${input.siteName}: ${plural(pull, 'line', 'lines')} to pull`
      : `${input.siteName}: today's list`;

  return {
    siteName: input.siteName,
    pull,
    markdown,
    check,
    overdue,
    rotationFixtures: input.rotationFixtures,
    title,
    body:
      parts.length > 0
        ? parts.join(', ') + (overdue > 0 ? ` · ${overdue} already past date` : '')
        : 'Nothing outstanding.',
    worthSending: pull + markdown + check + input.rotationFixtures > 0,
  };
}

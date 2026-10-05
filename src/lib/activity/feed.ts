/**
 * What happened at a site lately, as one list newest first: deliveries closed, stock written
 * off, reminders answered and fixtures checked. Free of the database so it can be tested;
 * feed-data.ts does the reading.
 */

export type ActivityKind = 'delivery' | 'waste' | 'answer' | 'rotation';

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at: string;
  actorId: string | null;
  /** What happened, without the person: "received Lion Dairy & Drinks (12 lines)". */
  text: string;
  href: string | null;
};

export type ClosedDelivery = { id: string; closedAt: string; receivedBy: string | null; supplier: string | null; lines: number };
export type WasteEntry = {
  id: string; wastedAt: string; wastedBy: string | null; batchId: string | null;
  product: string | null; qty: number; reason: string;
};
export type AnsweredReminder = {
  id: string; actionedAt: string; actionedBy: string | null; batchId: string;
  action: 'check' | 'markdown' | 'pull'; product: string | null;
  batchStatus: 'active' | 'pulled' | 'sold_through' | null; markedDown: boolean;
};
export type FixtureCheck = { id: string; checkedAt: string; checkedBy: string | null; fixture: string };

const REASON: Record<string, string> = {
  expired: 'expired', damaged: 'damaged', spoiled: 'spoiled', recalled: 'recalled',
  staff_error: 'staff error', other: 'other',
};

/**
 * What a reminder's answer amounted to. Only a batch's latest answer can be read from where the
 * batch ended up (sold out, pulled); an earlier one is told by what it asked.
 */
export function answerText(r: AnsweredReminder, latest = true): string {
  const product = r.product ?? 'an item';
  if (!latest) {
    if (r.action === 'check') return `checked the date on ${product}`;
    if (r.action === 'markdown') return `put ${product} on half price`;
    return `answered the last-day reminder for ${product}`;
  }
  if (r.batchStatus === 'sold_through') return `marked ${product} as sold out`;
  if (r.action === 'check') return `checked the date on ${product}`;
  if (r.action === 'markdown') return r.markedDown ? `put ${product} on half price` : `answered the half-price reminder for ${product}`;
  return r.batchStatus === 'pulled' ? `pulled ${product} off the shelf` : `answered the last-day reminder for ${product}`;
}

/**
 * Every source as one list, newest first, at most `limit` long. A last-day answer that binned
 * stock also wrote an expired waste row; that row says more (how many), so the answer is left out.
 */
export function buildFeed(sources: {
  deliveries: ClosedDelivery[];
  waste: WasteEntry[];
  answers: AnsweredReminder[];
  fixtures: FixtureCheck[];
}, limit: number): ActivityItem[] {
  // Only a pulled answer writes an 'expired' row; a damaged write-off is a separate event.
  const binned = new Set(sources.waste.flatMap((w) => (w.batchId && w.reason === 'expired' ? [w.batchId] : [])));
  const latestAnswer = new Map<string, AnsweredReminder>();
  for (const r of sources.answers) {
    const seen = latestAnswer.get(r.batchId);
    if (!seen || r.actionedAt > seen.actionedAt) latestAnswer.set(r.batchId, r);
  }
  const items: ActivityItem[] = [
    ...sources.deliveries.map((d): ActivityItem => ({
      id: `delivery:${d.id}`, kind: 'delivery', at: d.closedAt, actorId: d.receivedBy,
      text: `received ${d.supplier ?? 'a delivery'} (${d.lines} ${d.lines === 1 ? 'line' : 'lines'})`,
      href: `/manage/deliveries/${d.id}`,
    })),
    ...sources.waste.map((w): ActivityItem => ({
      id: `waste:${w.id}`, kind: 'waste', at: w.wastedAt, actorId: w.wastedBy,
      text: `wrote off ${w.qty} × ${w.product ?? 'an item'} (${REASON[w.reason] ?? w.reason})`,
      href: '/manage/waste',
    })),
    ...sources.answers
      .filter((r) => !(r.action === 'pull' && binned.has(r.batchId)))
      .map((r): ActivityItem => ({
        id: `answer:${r.id}`, kind: 'answer', at: r.actionedAt, actorId: r.actionedBy,
        text: answerText(r, latestAnswer.get(r.batchId) === r), href: '/manage/expiry',
      })),
    ...sources.fixtures.map((f): ActivityItem => ({
      id: `rotation:${f.id}`, kind: 'rotation', at: f.checkedAt, actorId: f.checkedBy,
      text: `checked the ${f.fixture} rotation`, href: null,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit));
}

/** "just now", "12 min ago", "3 h ago", then the site's date: how long ago, as a manager says it. */
export function whenAgo(at: string, now: Date, dateAtSite: (iso: string) => string): string {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return dateAtSite(at);
}

/** The time on the site's clock, "3:05 pm": when a dashboard's figures were read. */
export function clockAt(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
}

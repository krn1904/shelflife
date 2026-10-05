import type { AppRole } from '@/lib/supabase/types';

/**
 * Shared between the demo seed and the app's one-click login buttons, so the two can
 * never drift into offering a login that was never created.
 */
export const DEMO_ORG_SLUG = 'bp-melbourne-north-demo';

// Public on purpose: these accounts exist to be signed into from a portfolio page.
export const DEMO_PASSWORD = 'shelflife-demo';

export type DemoLogin = {
  email: string;
  fullName: string;
  role: AppRole;
  label: string;
  blurb: string;
  /**
   * Offered as a button on the login page. The platform admin is not: it can reach every
   * organisation and reset anyone's password, so it is seeded but handed out privately.
   */
  oneClick: boolean;
};

export const DEMO_LOGINS: DemoLogin[] = [
  {
    email: 'staff@demo.shelflife.app',
    fullName: 'Riley (demo staff)',
    role: 'staff',
    label: 'Staff',
    blurb: 'The phone view: today’s list, the expiry board, receiving a delivery.',
    oneClick: true,
  },
  {
    email: 'manager@demo.shelflife.app',
    fullName: 'Sam (demo manager)',
    role: 'manager',
    label: 'Manager',
    blurb: 'One site: the expiry board, waste analytics, ranging and par levels.',
    oneClick: true,
  },
  {
    email: 'owner@demo.shelflife.app',
    fullName: 'Dana (demo owner)',
    role: 'owner',
    label: 'Owner',
    blurb: 'Three sites: the rollup, the league table and the CSV export.',
    oneClick: true,
  },
  {
    email: 'admin@demo.shelflife.app',
    fullName: 'Platform (demo admin)',
    role: 'platform_admin',
    label: 'Platform admin',
    blurb: 'Across organisations: the catalogue, audit trail and scheduled job history.',
    oneClick: false,
  },
];

/** The logins the login page offers as buttons, and the only ones signInAsDemo accepts. */
export const ONE_CLICK_LOGINS = DEMO_LOGINS.filter((l) => l.oneClick);

export function oneClickLogin(email: string): DemoLogin | undefined {
  return ONE_CLICK_LOGINS.find((l) => l.email === email);
}

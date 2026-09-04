import type { Database } from '../src/lib/supabase/database.types';

/**
 * Shared between the demo seed and the app's one-click login buttons, so the two can
 * never drift into offering a login that was never created.
 */
export const DEMO_ORG_SLUG = 'demo-servo';

// Public on purpose: these accounts exist to be signed into from a portfolio page.
export const DEMO_PASSWORD = 'shelflife-demo';

export type DemoLogin = {
  email: string;
  fullName: string;
  role: Database['public']['Enums']['app_role'];
  label: string;
  blurb: string;
};

export const DEMO_LOGINS: DemoLogin[] = [
  {
    email: 'staff@demo.shelflife.app',
    fullName: 'Riley (demo staff)',
    role: 'staff',
    label: 'Staff',
    blurb: 'The phone view: today’s list, receiving a delivery, scan to waste.',
  },
  {
    email: 'manager@demo.shelflife.app',
    fullName: 'Sam (demo manager)',
    role: 'manager',
    label: 'Manager',
    blurb: 'One site: the expiry board, waste analytics, ranging and par levels.',
  },
  {
    email: 'owner@demo.shelflife.app',
    fullName: 'Dana (demo owner)',
    role: 'owner',
    label: 'Owner',
    blurb: 'Three sites: the rollup, the league table and the CSV export.',
  },
  {
    email: 'admin@demo.shelflife.app',
    fullName: 'Platform (demo admin)',
    role: 'platform_admin',
    label: 'Platform admin',
    blurb: 'Cross-tenant: the catalogue, the audit trail and scheduled job history.',
  },
];

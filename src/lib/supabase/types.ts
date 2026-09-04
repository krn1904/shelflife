import type { Database } from './database.types';

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

export type AppRole = Enums<'app_role'>;
export type TrackingMode = Enums<'tracking_mode'>;

export type Org = Tables<'orgs'>;
export type Site = Tables<'sites'>;
export type Membership = Tables<'memberships'>;
export type Supplier = Tables<'suppliers'>;
export type Product = Tables<'products'>;
export type SiteProduct = Tables<'site_products'>;
